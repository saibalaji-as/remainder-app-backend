const nodemailer = require('nodemailer');
const templateService = require('../services/template.service');
const sseManager = require('../sse.manager');
const supabase = require('../config/supabase');

/**
 * Creates a fresh Nodemailer transporter using current env vars.
 * Called per-send so credentials are always read from the live process env.
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,  // STARTTLS — port 465 (SSL) is blocked on Render free tier
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/**
 * Sends a reminder email to the given address.
 *
 * @param {object} params
 * @param {string} params.to                - Recipient email address
 * @param {string} params.contactName       - Contact's display name
 * @param {string} params.scheduledAt       - ISO date string of the appointment
 * @param {string} [params.notes]           - Optional appointment notes
 * @param {string} [params.tenantId]        - Tenant identifier (for template lookup and SSE)
 * @param {number|string} [params.reminderId]      - Reminder ID (for SSE payload)
 * @param {string} [params.appointmentTitle]       - Appointment title (for SSE payload)
 * @param {string} [params.confirmationLink]       - Confirmation link URL for Yes/No buttons
 */
async function sendReminderEmail({ to, contactName, scheduledAt, notes, tenantId, reminderId, appointmentTitle, confirmationLink }) {
  // Resolve template fields — prefer tenant-specific, fall back to defaults
  let fields;
  try {
    const tenantFields = tenantId ? await templateService.getByTenant(tenantId) : null;
    fields = tenantFields ?? templateService.getDefaults();
  } catch (_err) {
    fields = templateService.getDefaults();
  }

  // Build render context
  const context = {
    contactName,
    appointmentDate: new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    notes: notes || '',
  };

  // Render template fields with context values
  const rendered = templateService.renderTemplate(fields, context);

  // Build HTML body — replace newlines in body with <br> for HTML rendering
  const htmlBody = rendered.body.replace(/\n/g, '<br>');

  // Build optional Yes/No confirmation buttons section (only when confirmationLink is provided)
  const confirmationButtons = confirmationLink
    ? `<div style="margin: 1.5rem 0; text-align: center;">
    <a href="${confirmationLink}&response=yes" style="display:inline-block;padding:0.75rem 1.5rem;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">✓ Yes, I'll be there</a>
    &nbsp;&nbsp;
    <a href="${confirmationLink}&response=no" style="display:inline-block;padding:0.75rem 1.5rem;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">✗ No, I need to cancel</a>
  </div>`
    : '';

  const html = `<p>${rendered.greeting}</p>\n<p>${htmlBody}</p>\n${confirmationButtons}<p>${rendered.closing}</p>`;

  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      throw new Error('Email credentials not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in .env');
    }

    const transporter = createTransporter();

    const result = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject: rendered.subject,
      html,
    });

    // Emit SSE event to tenant clients after successful send
    if (tenantId !== undefined && tenantId !== null) {
      sseManager.emit(tenantId, 'email-sent', { reminderId, contactName, appointmentTitle });
    }

    // Mark reminder as sent
    if (reminderId) {
      await supabase
        .from('reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', reminderId);
    }

    return result;
  } catch (err) {
    // Don't mark as failed here — Bull will retry up to the configured attempts.
    // The processor's 'failed' event handler marks it failed only after all retries
    // are exhausted, preventing a successful retry from leaving status as 'failed'.
    throw err;
  }
}

module.exports = { sendReminderEmail };
