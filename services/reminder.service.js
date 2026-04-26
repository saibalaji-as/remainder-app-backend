const supabase = require('../config/supabase');

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

module.exports = { list, getById, fetchPending, updateStatus };
