const client = require('../config/twilio');
const supabase = require('../config/supabase');

async function sendSms({ to, message }) {
  return await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
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
    await sendSms({ to: phone, message });

    const { data, error } = await supabase
      .from('reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', reminderId);

    if (error) throw error;
    return data;
  } catch (err) {
    // Don't mark as failed here — Bull will retry up to the configured attempts.
    // The processor's 'failed' event handler marks it failed only after all retries
    // are exhausted, preventing a successful retry from leaving status as 'failed'.
    throw err;
  }
}

module.exports = { sendSms, buildMessage, sendReminderSms };
