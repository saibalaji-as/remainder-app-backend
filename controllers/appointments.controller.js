const supabase = require('../config/supabase');
const appointmentService = require('../services/appointment.service');

async function create(req, res, next) {
  try {
    const appointment = await appointmentService.createAppointment({
      tenantId: req.tenantId,
      contactId: req.body.contactId,
      title: req.body.title,
      scheduledAt: req.body.scheduledAt,
      reminderChannel: req.body.reminderChannel,
    });
    return res.status(201).json(appointment);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*, contacts(*)')
      .eq('tenant_id', req.tenantId);
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, update, remove };
