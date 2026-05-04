const { Router } = require('express');
const { sendSms } = require('../services/sms.service');
const sseManager = require('../sse.manager');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');

const router = Router();

router.post('/test-sms', async (req, res, next) => {
  try {
    const { to } = req.body;
    const result = await sendSms({ to, message: 'Test SMS from Reminder App' });
    return res.json({ success: true, sid: result.sid });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/test/nudge/:appointmentId
 * Dev-only: immediately fires an SSE nudge for the given appointment.
 * Useful for testing the nudge banner without waiting for the 5-min job.
 */
router.post('/nudge/:appointmentId', authMiddleware, tenantMiddleware, async (req, res, next) => {
  try {
    const { appointmentId } = req.params;
    const tenantId = req.tenantId;

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*, contacts(*)')
      .eq('id', appointmentId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const hasClients = sseManager.hasClients(tenantId);

    sseManager.emit(tenantId, 'appointment-needs-update', {
      appointmentId: appointment.id,
      title: appointment.title,
      contactName: appointment.contacts?.name ?? null,
      scheduledAt: appointment.scheduled_at,
    });

    console.log(`🧪 Test nudge fired for appointment ${appointmentId}, tenant ${tenantId}, SSE clients connected: ${hasClients}`);

    return res.json({
      success: true,
      sseClientsConnected: hasClients,
      nudge: {
        appointmentId: appointment.id,
        title: appointment.title,
        contactName: appointment.contacts?.name ?? null,
        scheduledAt: appointment.scheduled_at,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
