const supabase = require('../config/supabase');
const { scheduleReminders, skipPendingReminders } = require('./reminder.service');

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
    .select('*, contacts(*)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();
  if (error) throw error;
  return data;
};

const createAppointment = async ({ tenantId, contactId, title, scheduledAt, reminderChannel, notes }) => {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ tenant_id: tenantId, contact_id: contactId, title, scheduled_at: scheduledAt, reminder_channel: reminderChannel, notes: notes || null })
    .select()
    .single();
  if (error) throw error;

  // Fire-and-forget: schedule reminders without blocking the response
  console.log('[scheduleReminders] Triggering for appointment:', data.id, 'at:', data.scheduled_at, 'channel:', data.reminder_channel);
  scheduleReminders(data.id, data.scheduled_at, data.reminder_channel)
    .catch(err => console.error('[scheduleReminders] Error:', err.message, err.stack));

  return data;
};

const updateAppointment = async (id, tenantId, payload) => {
  // Enforce field whitelist: only allow snake_case whitelisted fields to reach Supabase.
  // The controller maps camelCase → snake_case before calling this function.
  const ALLOWED_FIELDS = ['title', 'notes', 'scheduled_at', 'reminder_channel'];
  const safePayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => ALLOWED_FIELDS.includes(key))
  );

  // Fetch the current appointment to detect scheduledAt changes before updating.
  // Use snake_case key (scheduled_at) — the controller always maps to snake_case.
  let currentAppointment = null;
  if (safePayload.scheduled_at !== undefined) {
    const { data: current, error: fetchError } = await supabase
      .from('appointments')
      .select('scheduled_at, reminder_channel')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (fetchError) throw fetchError;
    currentAppointment = current;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(safePayload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw error;

  // Reschedule reminders if scheduled_at changed
  if (
    currentAppointment &&
    safePayload.scheduled_at !== undefined &&
    safePayload.scheduled_at !== currentAppointment.scheduled_at
  ) {
    const reminderChannel = safePayload.reminder_channel || currentAppointment.reminder_channel;
    await skipPendingReminders(id);
    await scheduleReminders(id, safePayload.scheduled_at, reminderChannel);
  }

  return data;
};

const deleteAppointment = async (id, tenantId) => {
  await skipPendingReminders(id);
  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return { deleted: true };
};

module.exports = { listAppointments, getAppointmentById, createAppointment, updateAppointment, deleteAppointment };
