const { Router } = require('express');
const { sendSms } = require('../services/sms.service');

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

module.exports = router;
