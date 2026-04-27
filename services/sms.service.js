const client = require('../config/twilio');
const supabase = require('../config/supabase');

async function sendSms({ to, message }) {
  return await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
}

function buildMessage(contactName, scheduledAt, notes) {
  const date = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const notesPart = notes ? `${notes} ` : '';
  return `Hi ${contactName}, this is a reminder for your appointment on ${date}. ${notesPart}Reply YES to confirm or NO to cancel.`;
}

async function sendReminderSms(reminderId, appointment) {
  const contact = appointment.contacts || appointment.contact;
  const { scheduled_at } = appointment;
  const message = buildMessage(contact.name, scheduled_at, appointment.notes);

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
    const { data, error } = await supabase
      .from('reminders')
      .update({ status: 'failed' })
      .eq('id', reminderId);

    if (error) throw error;
    throw err;
  }
}

module.exports = { sendSms, buildMessage, sendReminderSms };
