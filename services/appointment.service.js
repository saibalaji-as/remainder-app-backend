const supabase = require('../config/supabase');
const { scheduleReminders } = require('../services/reminder.service');

const createAppointment = async ({ tenantId, contactId, title, scheduledAt, reminderChannel }) => {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ tenant_id: tenantId, contact_id: contactId, title, scheduled_at: scheduledAt, reminder_channel: reminderChannel })
    .select()
    .single();
  if (error) throw error;

  // Fire-and-forget: schedule reminders without blocking the response
  console.log('[scheduleReminders] Triggering for appointment:', data.id, 'at:', data.scheduled_at);
  scheduleReminders(data.id, data.scheduled_at)
    .catch(err => console.error('[scheduleReminders] Error:', err.message, err.stack));

  return data;
};

module.exports = { createAppointment };
