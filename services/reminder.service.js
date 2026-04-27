const supabase = require('../config/supabase');
const reminderQueue = require('../jobs/reminder.queue');

// reminders has no tenant_id — scope via join to appointments.tenant_id
const list = async (tenantId) => {
  const { data, error } = await supabase
    .from('reminders')
    .select('*, appointments!inner(tenant_id)')
    .eq('appointments.tenant_id', tenantId);
  if (error) throw error;
  return data;
};

const getById = async (tenantId, reminderId) => {
  const { data, error } = await supabase
    .from('reminders')
    .select('*, appointments!inner(tenant_id)')
    .eq('id', reminderId)
    .eq('appointments.tenant_id', tenantId)
    .single();
  if (error) throw error;
  return data;
};

const fetchPending = async (tenantId) => {
  const { data, error } = await supabase
    .from('reminders')
    .select('*, appointments!inner(tenant_id)')
    .eq('appointments.tenant_id', tenantId)
    .eq('status', 'pending');
  if (error) throw error;
  return data;
};

const updateStatus = async (reminderId, status) => {
  const { data, error } = await supabase
    .from('reminders')
    .update({ status })
    .eq('id', reminderId);
  if (error) throw error;
  return data;
};

async function scheduleReminders(appointmentId, scheduledAt) {
  const reminders = [
    { offsetMs: 24 * 60 * 60 * 1000, channel: 'sms' },   // 24h before
    { offsetMs: 2 * 60 * 60 * 1000, channel: 'sms' },    // 2h before
    { offsetMs: 30 * 60 * 1000, channel: 'email' },      // 30min before
    { offsetMs: 2 * 60 * 1000, channel: 'sms' },         // TEST: 2min before — remove in production
  ];

  for (const { offsetMs, channel } of reminders) {
    const reminderTime = new Date(scheduledAt).getTime() - offsetMs;
    const delay = reminderTime - Date.now();

    if (delay <= 0) continue; // skip past windows

    const { data, error } = await supabase
      .from('reminders')
      .insert({ appointment_id: appointmentId, channel, status: 'pending', scheduled_at: new Date(reminderTime).toISOString() })
      .select()
      .single();

    if (error) throw error;

    await reminderQueue.add(
      { reminderId: data.id, appointmentId, channel },
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false }
    );
    console.log(`📅 Queued ${channel} reminder for appointment ${appointmentId} in ${Math.round(delay / 60000)}min`);
  }
}

const getPendingReminders = async () => {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending');
  if (error) throw error;
  return data;
};

const markReminderSent = async (id) => {
  return updateStatus(id, 'sent');
};

module.exports = { list, getById, fetchPending, updateStatus, scheduleReminders, getPendingReminders, markReminderSent };
