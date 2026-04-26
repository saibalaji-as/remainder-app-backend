const stripe = require('../config/stripe');
const supabase = require('../config/supabase');

async function createSubscription({ tenantId, priceId, paymentMethodId }) {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();
  if (tenantError) throw tenantError;

  let customer;
  if (tenant.stripe_customer_id) {
    customer = { id: tenant.stripe_customer_id };
  } else {
    customer = await stripe.customers.create({
      email: tenant.email,
      name: tenant.name,
    });
  }

  await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
  });

  const { data: record, error: upsertError } = await supabase
    .from('subscriptions')
    .upsert({
      tenant_id: tenantId,
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
    })
    .select()
    .single();
  if (upsertError) throw upsertError;

  return record;
}

async function cancelSubscription({ tenantId }) {
  const { data: sub, error: findError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();
  if (findError) throw findError;

  await stripe.subscriptions.cancel(sub.stripe_subscription_id);

  const { data: updated, error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (updateError) throw updateError;

  return updated;
}

module.exports = { createSubscription, cancelSubscription };
