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

async function scheduleReminders(appointmentId, scheduledAt, reminderChannel = 'sms') {
  // Build reminder schedule based on the appointment's chosen channel
  const useEmail    = reminderChannel === 'email'          || reminderChannel === 'both'
                   || reminderChannel === 'whatsapp_email' || reminderChannel === 'all';
  const useSms      = reminderChannel === 'sms'            || reminderChannel === 'both'
                   || reminderChannel === 'whatsapp_sms'   || reminderChannel === 'all';
  const useWhatsApp = reminderChannel === 'whatsapp'
                   || reminderChannel === 'whatsapp_sms'
                   || reminderChannel === 'whatsapp_email' || reminderChannel === 'all';

  const reminders = [
    ...(useSms       ? [{ offsetMs: 24 * 60 * 60 * 1000, channel: 'sms'      }] : []),  // 24h before
    ...(useSms       ? [{ offsetMs:  2 * 60 * 60 * 1000, channel: 'sms'      }] : []),  // 2h before
    ...(useWhatsApp  ? [{ offsetMs: 24 * 60 * 60 * 1000, channel: 'whatsapp' }] : []),  // 24h before
    ...(useWhatsApp  ? [{ offsetMs:  2 * 60 * 60 * 1000, channel: 'whatsapp' }] : []),  // 2h before
    ...(useEmail     ? [{ offsetMs:      30 * 60 * 1000, channel: 'email'    }] : []),  // 30min before

    // Test
    ...(useSms     ? [{ offsetMs:      2 * 60 * 1000, channel: 'sms'    }] : []),  // 2min before
    ...(useEmail     ? [{ offsetMs:      2 * 60 * 1000, channel: 'email'    }] : []),  // 2min before
    ...(useWhatsApp     ? [{ offsetMs:      2 * 60 * 1000, channel: 'whatsapp'    }] : []),  // 2min before
  ];

  for (const { offsetMs, channel } of reminders) {
    const reminderTime = new Date(scheduledAt).getTime() - offsetMs;
    const delay = reminderTime - Date.now();

    if (delay <= 0) {
      console.log(`⏭ Skipping ${channel} reminder (window already passed) for appointment ${appointmentId}`);
      continue; // skip past windows
    }

    const { data, error } = await supabase
      .from('reminders')
      .insert({ appointment_id: appointmentId, channel, status: 'pending', scheduled_at: new Date(reminderTime).toISOString() })
      .select()
      .single();

    if (error) throw error;

    await reminderQueue.add(
      {
        reminderId: data.id,
        appointmentId,
        channel,
        // Snapshot URLs at queue time so the processor always uses the correct
        // values regardless of env var changes or instance restarts between
        // scheduling and execution.
        frontendUrl: process.env.FRONTEND_URL,
        backendUrl: process.env.BACKEND_URL,
      },
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

const retryReminder = async (tenantId, reminderId) => {
  const reminder = await getById(tenantId, reminderId);

  if (!reminder) return null;

  if (reminder.status !== 'failed') {
    throw { status: 400, message: 'Reminder is not in failed state' };
  }

  // Update status to pending
  const { data: updatedData, error: updateError } = await supabase
    .from('reminders')
    .update({ status: 'pending' })
    .eq('id', reminder.id)
    .select()
    .single();

  if (updateError) throw updateError;

  // Enqueue a new BullMQ job; roll back on failure
  try {
    await reminderQueue.add(
      {
        reminderId: reminder.id,
        appointmentId: reminder.appointment_id,
        channel: reminder.channel,
        frontendUrl: process.env.FRONTEND_URL,
        backendUrl: process.env.BACKEND_URL,
      },
      { delay: 0, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false }
    );
  } catch (enqueueError) {
    // Roll back status to failed
    await supabase
      .from('reminders')
      .update({ status: 'failed' })
      .eq('id', reminder.id);
    throw enqueueError;
  }

  return updatedData;
};

const skipPendingReminders = async (appointmentId) => {
  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'skipped' })
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending');
  if (error) throw error;
  return data;
};

module.exports = { list, getById, fetchPending, updateStatus, scheduleReminders, getPendingReminders, markReminderSent, retryReminder, skipPendingReminders };
