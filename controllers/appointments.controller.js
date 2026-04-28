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
    const data = await appointmentService.listAppointments(req.tenantId);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const data = await appointmentService.getAppointmentById(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const data = await appointmentService.updateAppointment(req.params.id, req.tenantId, req.body);
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await appointmentService.deleteAppointment(req.params.id, req.tenantId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, update, remove };
