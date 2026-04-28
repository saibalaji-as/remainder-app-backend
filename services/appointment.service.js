const supabase = require('../config/supabase');
const { scheduleReminders } = require('../services/reminder.service');

const listAppointments = async (tenantId) => {
  const { data, error } = await supabase
    .from('appointments')
    .select('*, contacts(*)')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return data;
};

const getAppointmentById = async (id, tenantId) => {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();
  if (error) throw error;
  return data;
};

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

const updateAppointment = async (id, tenantId, payload) => {
  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

const deleteAppointment = async (id, tenantId) => {
  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return { deleted: true };
};

module.exports = { listAppointments, getAppointmentById, createAppointment, updateAppointment, deleteAppointment };
