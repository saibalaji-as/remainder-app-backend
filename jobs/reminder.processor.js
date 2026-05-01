const reminderQueue = require('./reminder.queue');
const smsService = require('../services/sms.service');
const emailService = require('../services/email.service');
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

  if (channel === 'sms') {
    await smsService.sendReminderSms(reminderId, appointment);
  } else if (channel === 'email') {
    await emailService.sendReminderEmail({
      to: appointment.contacts.email,
      contactName: appointment.contacts.name,
      scheduledAt: appointment.scheduled_at,
      notes: appointment.notes,
      tenantId: appointment.tenant_id,
      reminderId,
      appointmentTitle: appointment.title,
    });
  }

  await supabase
    .from('reminders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', reminderId);

  console.log('✅ Reminder job ' + job.id + ' completed');
});

reminderQueue.on('failed', (job, err) => {
  console.error('❌ Reminder job ' + job.id + ' failed: ' + err.message);
});

module.exports = reminderQueue;
