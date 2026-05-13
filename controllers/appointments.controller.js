const appointmentService = require('../services/appointment.service');
const supabase = require('../config/supabase');
const sseManager = require('../sse.manager');
const { skipPendingReminders } = require('../services/reminder.service');

const ALLOWED_TRANSITIONS = {
  scheduled:  ['confirmed', 'cancelled'],
  confirmed:  ['completed', 'cancelled'],
  completed:  [],
  cancelled:  [],
};

async function create(req, res, next) {
  try {
    const appointment = await appointmentService.createAppointment({
      tenantId: req.tenantId,
      contactId: req.body.contactId,
      title: req.body.title,
      scheduledAt: req.body.scheduledAt,
      reminderChannel: req.body.reminderChannel,
      notes: req.body.notes,
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
    const { title, scheduledAt, notes, reminderChannel } = req.body;
    const payload = {
      ...(title !== undefined           && { title }),
      ...(notes !== undefined           && { notes }),
      ...(scheduledAt !== undefined     && { scheduled_at: new Date(scheduledAt).toISOString() }),
      ...(reminderChannel !== undefined && { reminder_channel: reminderChannel }),
    };
    const data = await appointmentService.updateAppointment(req.params.id, req.tenantId, payload);
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

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status: newStatus } = req.body;

    // Fetch current appointment scoped to tenant
    const { data: current, error: fetchError } = await supabase
      .from('appointments')
      .select('*, contacts(*)')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single();

    if (fetchError || !current) {
      return res.status(404).json({ message: 'Not found' });
    }

    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[current.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        message: `Invalid status transition from ${current.status} to ${newStatus}`,
      });
    }

    // Perform the update
    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update({ status: newStatus })
      .eq('id', id)
      .select()
      .single();

    if (updateError) return next(updateError);

    // Side effects based on new status
    if (newStatus === 'cancelled' || newStatus === 'completed') {
      await skipPendingReminders(id);
    }

    if (newStatus === 'completed') {
      sseManager.emit(req.tenantId, 'appointment-completed', {
        appointmentId: updated.id,
        title: updated.title,
        contactName: current.contacts?.name,
      });
    }

    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, update, remove, updateStatus };
