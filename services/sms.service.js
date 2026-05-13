const client = require('../config/twilio');
const supabase = require('../config/supabase');

async function sendSms({ to, message }) {
  const payload = {
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  };

  if (process.env.BACKEND_URL) {
    payload.statusCallback = `${process.env.BACKEND_URL}/api/webhooks/twilio/sms-status`;
  }

  return await client.messages.create(payload);
}

function buildMessage(contactName, scheduledAt, notes, confirmationLink) {
  const date = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const notesPart = notes ? ` ${notes}` : '';
  const base = `Hi ${contactName}, reminder: appointment on ${date}.${notesPart} Reply YES/NO.`;
  return confirmationLink ? `${base} Confirm: ${confirmationLink}` : base;
}

async function sendReminderSms(reminderId, appointment, confirmationLink) {
  const contact = appointment.contacts || appointment.contact;
  const { scheduled_at } = appointment;
  const message = buildMessage(contact.name, scheduled_at, appointment.notes, confirmationLink);

  // Normalize to E.164 — prepend +91 if no country code present
  const phone = contact.phone.startsWith('+') ? contact.phone : `+91${contact.phone}`;

  try {
    const twilioMessage = await sendSms({ to: phone, message });

    const { data, error } = await supabase
      .from('reminders')
      .update({
        status: 'pending',
        provider_message_id: twilioMessage.sid,
        provider_status: twilioMessage.status || 'queued',
        provider_error_code: null,
      })
      .eq('id', reminderId);

    if (error) {
      console.warn(`⚠️ SMS sent but reminder metadata update failed for ${reminderId}:`, error.message);
    }
    return data;
  } catch (err) {
    // Log Twilio-specific error details to help diagnose delivery failures
    console.error(`❌ SMS send failed for reminder ${reminderId} to ${phone}:`, err.message, err.code ? `(Twilio code: ${err.code})` : '');
    // Don't mark as failed here — Bull will retry up to the configured attempts.
    // The processor's 'failed' event handler marks it failed only after all retries
    // are exhausted, preventing a successful retry from leaving status as 'failed'.
    throw err;
  }
}

module.exports = { sendSms, buildMessage, sendReminderSms };
