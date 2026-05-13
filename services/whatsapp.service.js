const client = require('../config/twilio');
const supabase = require('../config/supabase');
const sseManager = require('../sse.manager');

/**
 * Sends a WhatsApp message via Twilio.
 * @param {{ to: string, message: string }} params
 */
async function sendWhatsAppMessage({ to, message }) {
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) throw new Error('TWILIO_WHATSAPP_NUMBER must be set');

  // Normalise to E.164 then prepend whatsapp: prefix
  const normalised = to.startsWith('+') ? to : `+91${to}`;
  const waTo = normalised.startsWith('whatsapp:') ? normalised : `whatsapp:${normalised}`;

  return await client.messages.create({ body: message, from, to: waTo });
}

/**
 * Builds the WhatsApp reminder message text.
 * @param {string} contactName
 * @param {string} scheduledAt  - ISO date string
 * @param {string|null} notes
 * @param {string|null} confirmationLink
 * @returns {string}
 */
function buildWhatsAppMessage(contactName, scheduledAt, notes, confirmationLink) {
  const date = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const notesPart = notes ? `${notes} ` : '';
  const base = `Hi ${contactName}, this is a reminder for your appointment on ${date}. ${notesPart}Reply YES to confirm or NO to cancel.`;
  return confirmationLink ? `${base} Confirm or cancel here: ${confirmationLink}` : base;
}

/**
 * Composes and dispatches a WhatsApp reminder, then updates the DB record.
 * @param {string} reminderId
 * @param {object} appointment  - includes contacts sub-object
 * @param {string} confirmationLink
 * @param {string} [tenantId]         - tenant ID for SSE emit
 * @param {string} [contactName]      - contact name for SSE payload
 * @param {string} [appointmentTitle] - appointment title for SSE payload
 */
async function sendReminderWhatsApp(reminderId, appointment, confirmationLink, tenantId, contactName, appointmentTitle) {
  // Sandbox guard: when WHATSAPP_SANDBOX_MODE=true, the Twilio Sandbox requires
  // each recipient to opt in. Skip the send and mark the reminder as 'skipped'
  // to avoid recording a false 'sent' status for undelivered messages.
  if (process.env.WHATSAPP_SANDBOX_MODE === 'true') {
    console.warn('[WhatsApp] Sandbox mode: skipping send — recipient may not have opted in');
    await supabase.from('reminders').update({ status: 'skipped' }).eq('id', reminderId);
    return null;
  }

  const contact = appointment.contacts || appointment.contact;
  const { scheduled_at } = appointment;
  const message = buildWhatsAppMessage(contact.name, scheduled_at, appointment.notes, confirmationLink);

  // Normalise phone — prepend +91 if no country code present
  const phone = contact.phone.startsWith('+') ? contact.phone : `+91${contact.phone}`;

  try {
    await sendWhatsAppMessage({ to: phone, message });

    const { data, error } = await supabase
      .from('reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', reminderId);

    if (error) throw error;

    // Emit SSE event to tenant clients after successful send
    const resolvedTenantId = tenantId || appointment.tenant_id;
    if (resolvedTenantId) {
      const resolvedContactName = contactName || contact.name;
      const resolvedTitle = appointmentTitle || appointment.title;
      sseManager.emit(resolvedTenantId, 'whatsapp-sent', {
        reminderId,
        contactName: resolvedContactName,
        appointmentTitle: resolvedTitle,
      });
    }

    return data;
  } catch (err) {
    // Don't mark as failed here — Bull will retry up to the configured attempts.
    // The processor's 'failed' event handler marks it failed only after all retries
    // are exhausted, preventing a successful retry from leaving status as 'failed'.
    throw err;
  }
}

module.exports = { sendWhatsAppMessage, buildWhatsAppMessage, sendReminderWhatsApp };
