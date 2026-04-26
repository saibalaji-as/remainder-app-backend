const supabase = require('../config/supabase');

async function create(req, res, next) {
  try {
    const { name, email, phone } = req.body;
    const { data, error } = await supabase
      .from('contacts')
      .insert({ tenant_id: req.tenantId, name, email, phone })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('tenant_id', req.tenantId);
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getById, update, remove };
