const supabase = require('../config/supabase');

const getContacts = async (tenantId) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return data;
};

const createContact = async (tenantId, payload) => {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ tenant_id: tenantId, ...payload })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const updateContact = async (id, payload) => {
  const { data, error } = await supabase
    .from('contacts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

const deleteContact = async (id) => {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

module.exports = { getContacts, createContact, updateContact, deleteContact };
