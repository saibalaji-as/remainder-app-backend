const supabase = require('../config/supabase');
const { addReminderJob } = require('../jobs/reminder.queue');

const createAppointment = async ({ tenantId, contactId, title, scheduledAt, reminderChannel }) => {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ tenant_id: tenantId, contact_id: contactId, title, scheduled_at: scheduledAt, reminder_channel: reminderChannel })
    .select()
    .single();
  if (error) throw error;

  const appointment = data;

  const { data: reminderData, error: reminderError } = await supabase
    .from('reminders')
    .insert({ appointment_id: appointment.id, channel: reminderChannel, status: 'pending', scheduled_at: scheduledAt })
    .select()
    .single();
  if (reminderError) throw reminderError;

  const delay = new Date(scheduledAt).getTime() - Date.now() - 24 * 60 * 60 * 1000;
  await addReminderJob(
    {
      reminderId: reminderData.id,
      appointmentId: appointment.id,
      tenantId,
      channel: reminderChannel,
      scheduledAt,
    },
    delay
  );

  return appointment;
};

const scheduleReminderJob = async (appointment) => {
  const delay = new Date(appointment.scheduled_at).getTime() - Date.now() - 24 * 60 * 60 * 1000;
  const job = await addReminderJob(
    {
      appointmentId: appointment.id,
      tenantId: appointment.tenant_id,
      channel: appointment.reminder_channel,
      scheduledAt: appointment.scheduled_at,
    },
    delay
  );
  return job;
};

module.exports = { createAppointment, scheduleReminderJob };
