/**
 * Push Notification Service
 *
 * Handles storing/removing Web Push subscriptions and sending
 * push notifications to all subscriptions for a given tenant.
 *
 * Uses the `web-push` library with VAPID authentication.
 */

const webpush = require('web-push');
const supabase = require('../config/supabase');

// Configure VAPID — required once at module load
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || process.env.EMAIL_USER || 'admin@schedify.app'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Save (upsert) a push subscription for a user.
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 */
async function saveSubscription(tenantId, userId, subscription) {
  const { endpoint, keys } = subscription;
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { tenant_id: tenantId, user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'tenant_id,user_id,endpoint' }
    );
  if (error) throw error;
}

/**
 * Remove a push subscription by endpoint.
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} endpoint
 */
async function removeSubscription(tenantId, userId, endpoint) {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('endpoint', endpoint);
  if (error) throw error;
}

/**
 * Send a push notification to every subscription registered for a tenant.
 * Stale/expired subscriptions (410 Gone) are automatically removed.
 *
 * @param {string} tenantId
 * @param {{ title: string, body: string, data?: object }} payload
 */
async function sendToTenant(tenantId, payload) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('❌ Push — failed to fetch subscriptions:', error.message);
    return;
  }

  if (!subs || subs.length === 0) return;

  const notification = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    icon:  'assets/icons/icon-192x192.png',
    badge: 'assets/icons/icon-72x72.png',
    data:  payload.data ?? {},
  });

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        notification
      )
    )
  );

  // Clean up expired/invalid subscriptions
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const statusCode = result.reason?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription is gone — remove it silently
        console.log(`🗑 Push — removing stale subscription for tenant ${tenantId}`);
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subs[i].endpoint);
      } else {
        console.error(`❌ Push — failed to send to subscription:`, result.reason?.message);
      }
    }
  }
}

module.exports = { saveSubscription, removeSubscription, sendToTenant };
