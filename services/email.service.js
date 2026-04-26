const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendReminderEmail({ to, contactName, scheduledAt, notes }) {
  const date = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const subject = `Appointment Reminder — ${date}`;

  const notesSection = notes
    ? `<p><strong>Notes:</strong> ${notes}</p>`
    : '';

  const html = `
    <p>Hi ${contactName},</p>
    <p>This is a reminder for your upcoming appointment scheduled on <strong>${date}</strong>.</p>
    ${notesSection}
    <p>If you need to reschedule or have any questions, please reply to this email.</p>
  `;

  try {
    return await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    throw err;
  }
}

module.exports = { sendReminderEmail };
