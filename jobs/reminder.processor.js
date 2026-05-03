const jwt = require('jsonwebtoken');
const reminderQueue = require('./reminder.queue');
const smsService = require('../services/sms.service');
const emailService = require('../services/email.service');
const whatsappService = require('../services/whatsapp.service');
const supabase = require('../config/supabase');

reminderQueue.process(async (job) => {
  const { reminderId, appointmentId, channel } = job.data;

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('*, contacts(*)')
    .eq('id', appointmentId)
    .single();

  if (error) throw error;
  if (!appointment) throw new Error('Appointment not found');

  if (appointment.status === 'cancelled') {
    await supabase
      .from('reminders')
      .update({ status: 'skipped' })
      .eq('id', reminderId);
    return { skipped: true };
  }

  // Generate confirmation token and store it before dispatching the reminder
  const tenantId = appointment.tenant_id;
  const token = jwt.sign(
    { appointmentId, tenantId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { error: tokenUpdateError } = await supabase
    .from('appointments')
    .update({ confirmation_token: token })
    .eq('id', appointmentId);

  if (tokenUpdateError) throw tokenUpdateError;

  const confirmationLink = `${process.env.FRONTEND_URL}/confirm?token=${token}`;
  // Short link for SMS — keeps message under 160 chars to avoid multi-segment issues
  const smsConfirmationLink = `${process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`}/api/confirm/r/${appointmentId}`;

  console.log(`🔗 Confirmation link generated for appointmentId: ${appointmentId}`);

  if (channel === 'sms') {
    await smsService.sendReminderSms(reminderId, appointment, smsConfirmationLink);
  } else if (channel === 'email') {
    if (!appointment.contacts?.email) {
      throw new Error(`Contact has no email address for reminder ${reminderId}`);
    }
    await emailService.sendReminderEmail({
      to: appointment.contacts.email,
      contactName: appointment.contacts.name,
      scheduledAt: appointment.scheduled_at,
      notes: appointment.notes,
      tenantId: appointment.tenant_id,
      reminderId,
      appointmentTitle: appointment.title,
      confirmationLink,
    });
  } else if (channel === 'whatsapp') {
    if (!appointment.contacts?.phone) {
      throw new Error(`Contact has no phone number for reminder ${reminderId}`);
    }
    await whatsappService.sendReminderWhatsApp(
      reminderId,
      appointment,
      confirmationLink,
      appointment.tenant_id,
      appointment.contacts.name,
      appointment.title
    );
  } else {
    throw new Error(`Unknown reminder channel "${channel}" for reminder ${reminderId}`);
  }
  // Note: each service (sms/email/whatsapp) handles its own status update internally.

  console.log(`✅ Reminder job ${job.id} completed (${channel}) for appointmentId: ${appointmentId}`);
});

reminderQueue.on('failed', async (job, err) => {
  console.error(`❌ Reminder job ${job.id} failed (channel: ${job.data?.channel}, reminderId: ${job.data?.reminderId}): ${err.message}`);
  // Mark the reminder as failed in the DB after all retries are exhausted
  if (job.attemptsMade >= job.opts.attempts) {
    await supabase
      .from('reminders')
      .update({ status: 'failed' })
      .eq('id', job.data?.reminderId);
  }
});

module.exports = reminderQueue;
