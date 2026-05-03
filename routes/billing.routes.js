const { Router } = require('express');
const express = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const billingService = require('../services/billing.service');
const stripe = require('../config/stripe');

const router = Router();

// ── Stripe Webhook (must be BEFORE authMiddleware and express.json()) ────────
// Uses express.raw() to preserve the raw body for Stripe signature verification.
// This route is registered here but also mounted directly in app.js before
// express.json() to ensure the raw body is available.
async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    const supabase = require('../config/supabase');

    switch (event.type) {
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', subscription.id);
        console.log(`[Stripe Webhook] Subscription canceled: ${subscription.id}`);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await supabase
          .from('subscriptions')
          .update({ status: subscription.status })
          .eq('stripe_subscription_id', subscription.id);
        console.log(`[Stripe Webhook] Subscription updated: ${subscription.id} → ${subscription.status}`);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await supabase
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer);
        console.log(`[Stripe Webhook] Payment failed for customer: ${invoice.customer}`);
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[Stripe Webhook] Error processing event:', err.message);
    return res.status(500).json({ error: 'Internal server error processing webhook' });
  }

  return res.status(200).json({ received: true });
}

router.post('/webhook', express.raw({ type: 'application/json' }), webhookHandler);

// ── Auth-protected billing routes ────────────────────────────────────────────
router.use(authMiddleware, tenantMiddleware);

router.get('/subscribe', async (req, res) => {
  try {
    const supabase = require('../config/supabase');
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle();
    if (error) throw error;
    return res.status(200).json({ subscription: data ?? null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/subscribe',
  [
    body('priceId').notEmpty(),
    body('paymentMethodId').notEmpty(),
  ],
  validateMiddleware,
  async (req, res) => {
    try {
      const record = await billingService.createSubscription({
        tenantId: req.tenantId,
        ...req.body,
      });
      return res.status(200).json(record);
    } catch (err) {
      return res.status(402).json({ error: err.message });
    }
  }
);

router.delete('/subscribe', async (req, res) => {
  try {
    const record = await billingService.cancelSubscription({ tenantId: req.tenantId });
    return res.status(200).json(record);
  } catch (err) {
    return res.status(402).json({ error: err.message });
  }
});

module.exports = router;
module.exports.webhookHandler = webhookHandler;
