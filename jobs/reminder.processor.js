const { queue } = require('./reminder.queue');
const smsService = require('../services/sms.service');
const emailService = require('../services/email.service');
const reminderService = require('../services/reminder.service');

queue.process(async (job) => {
  const {
    reminderId,
    channel,
    contactPhone,
    contactEmail,
    appointmentTitle,
    scheduledAt,
  } = job.data;

  if (channel === 'sms') {
    await smsService.sendReminderSms(reminderId, {
      contact: { name: appointmentTitle, phone: contactPhone },
      scheduled_at: scheduledAt,
      notes: null,
    });
  } else if (channel === 'email') {
    await emailService.sendReminderEmail({
      to: contactEmail,
      contactName: appointmentTitle,
      scheduledAt,
      notes: null,
    });
  } else if (channel === 'both') {
    await Promise.all([
      smsService.sendReminderSms(reminderId, {
        contact: { name: appointmentTitle, phone: contactPhone },
        scheduled_at: scheduledAt,
        notes: null,
      }),
      emailService.sendReminderEmail({
        to: contactEmail,
        contactName: appointmentTitle,
        scheduledAt,
        notes: null,
      }),
    ]);
  }

  await reminderService.updateStatus(reminderId, 'sent');
});

queue.on('failed', (job, err) => {
  reminderService.updateStatus(job.data.reminderId, 'failed');
  console.error(err);
});

module.exports = { queue };
