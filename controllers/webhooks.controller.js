const supabase = require('../config/supabase');
const twilio = require('twilio');

const SUCCESS_STATUSES = new Set(['delivered']);
const FAILURE_STATUSES = new Set(['failed', 'undelivered']);

function isValidTwilioRequest(req) {
  const signature = req.headers['x-twilio-signature'];
  if (!process.env.TWILIO_AUTH_TOKEN || !process.env.BACKEND_URL || !signature) {
    return process.env.NODE_ENV !== 'production';
  }

  const backendUrl = process.env.BACKEND_URL.replace(/\/+$/, '');
  const url = `${backendUrl}${req.originalUrl}`;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
}

async function twilioSmsStatus(req, res, next) {
  try {
    if (!isValidTwilioRequest(req)) {
      return res.status(403).json({ message: 'Invalid Twilio signature' });
    }

    const messageSid = req.body.MessageSid || req.body.SmsSid;
    const providerStatus = req.body.MessageStatus || req.body.SmsStatus;
    const errorCode = req.body.ErrorCode || null;

    if (!messageSid || !providerStatus) {
      return res.status(400).json({ message: 'MessageSid and MessageStatus are required' });
    }

    const patch = {
      provider_status: providerStatus,
      provider_error_code: errorCode,
    };

    if (SUCCESS_STATUSES.has(providerStatus)) {
      patch.status = 'sent';
      patch.sent_at = new Date().toISOString();
    } else if (FAILURE_STATUSES.has(providerStatus)) {
      patch.status = 'failed';
    }

    const { error } = await supabase
      .from('reminders')
      .update(patch)
      .eq('provider_message_id', messageSid);

    if (error) throw error;

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { twilioSmsStatus };
