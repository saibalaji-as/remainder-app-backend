const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const sseManager = require('../sse.manager');
const { skipPendingReminders } = require('../services/reminder.service');

/**
 * GET /api/confirm?token=xxx
 *
 * Verifies the JWT confirmation token, fetches the appointment + contact,
 * and returns public-safe fields.
 *
 * Requirements: 3.7, 3.8
 */
async function getAppointmentByToken(req, res, next) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(400).json({ message: 'Confirmation link has expired' });
      }
      // JsonWebTokenError and any other JWT error
      return res.status(400).json({ message: 'Invalid confirmation link' });
    }

    const { appointmentId } = payload;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*, contacts(*)')
      .eq('id', appointmentId)
      .single();

    if (error) return next(error);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    return res.json({
      appointmentId: appointment.id,
      title: appointment.title,
      contactName: appointment.contacts?.name ?? null,
      scheduledAt: appointment.scheduled_at,
      notes: appointment.notes ?? null,
      status: appointment.status,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/confirm  { token, response: 'yes' | 'no' }
 *
 * Verifies the JWT, checks idempotency, validates the stored token, then
 * updates the appointment status and emits the appropriate SSE event.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.9, 3.10, 3.11
 */
async function respondToConfirmation(req, res, next) {
  try {
    const { token, response } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    if (!response || !['yes', 'no'].includes(response)) {
      return res.status(400).json({ message: 'Response must be yes or no' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(400).json({ message: 'Confirmation link has expired' });
      }
      return res.status(400).json({ message: 'Invalid confirmation link' });
    }

    const { appointmentId, tenantId } = payload;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*, contacts(*)')
      .eq('id', appointmentId)
      .single();

    if (error) return next(error);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    // Idempotency: already actioned — return current status without re-updating
    if (appointment.status === 'confirmed' || appointment.status === 'cancelled') {
      return res.json({ status: appointment.status });
    }

    // Stale link check: stored token must match the token in the request
    if (appointment.confirmation_token !== token) {
      return res.status(400).json({ message: 'This confirmation link is no longer valid' });
    }

    const newStatus = response === 'yes' ? 'confirmed' : 'cancelled';

    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update({ status: newStatus })
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateError) return next(updateError);

    if (response === 'no') {
      // Skip all pending reminders for this appointment
      await skipPendingReminders(appointmentId);

      // Emit SSE event to tenant clients
      sseManager.emit(tenantId, 'appointment-cancelled', {
        appointmentId,
        title: appointment.title,
        contactName: appointment.contacts?.name ?? null,
      });
    } else {
      // Emit SSE event to tenant clients
      sseManager.emit(tenantId, 'appointment-confirmed', {
        appointmentId,
        title: appointment.title,
        contactName: appointment.contacts?.name ?? null,
      });
    }

    return res.json({ status: newStatus });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getAppointmentByToken, respondToConfirmation, redirectByAppointmentId };

/**
 * GET /api/confirm/r/:appointmentId
 *
 * Short-link redirect used in SMS reminders to keep message length under 160 chars.
 * Looks up the stored confirmation_token for the appointment and redirects to the
 * frontend confirm page with the full token as a query param.
 */
async function redirectByAppointmentId(req, res, next) {
  try {
    const { appointmentId } = req.params;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('confirmation_token')
      .eq('id', appointmentId)
      .single();

    if (error) return next(error);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    if (!appointment.confirmation_token) {
      return res.status(400).json({ message: 'No confirmation link available for this appointment' });
    }

    const redirectUrl = `${process.env.FRONTEND_URL}/confirm?token=${appointment.confirmation_token}`;
    return res.redirect(302, redirectUrl);
  } catch (err) {
    return next(err);
  }
}
