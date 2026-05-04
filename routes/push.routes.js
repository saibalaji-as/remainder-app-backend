const { Router } = require('express');
const authMiddleware   = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const pushService      = require('../services/push.service');

const router = Router();

// All push routes require auth
router.use(authMiddleware, tenantMiddleware);

/**
 * POST /api/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth } }
 * Saves the browser's push subscription for the current user.
 */
router.post('/subscribe', async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid subscription object' });
    }

    await pushService.saveSubscription(req.tenantId, req.user.userId, { endpoint, keys });
    return res.status(201).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/push/unsubscribe
 * Body: { endpoint }
 * Removes the push subscription (called when user revokes permission).
 */
router.delete('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required' });

    await pushService.removeSubscription(req.tenantId, req.user.userId, endpoint);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/push/vapid-public-key
 * Returns the VAPID public key so the frontend can subscribe.
 */
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

module.exports = router;
