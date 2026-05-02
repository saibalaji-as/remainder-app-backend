const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const confirmController = require('../controllers/confirm.controller');
const validateMiddleware = require('../middleware/validate.middleware');

const router = express.Router();

// GET /r/:appointmentId → short-link redirect (used in SMS to keep message short)
router.get('/r/:appointmentId', confirmController.redirectByAppointmentId);

// GET / → fetch appointment details by token (public, no auth)
router.get('/', confirmController.getAppointmentByToken);

// POST / → submit confirmation response (public, rate-limited)
router.post(
  '/',
  rateLimit({ windowMs: 60_000, max: 10 }),
  body('token').notEmpty(),
  body('response').isIn(['yes', 'no']),
  validateMiddleware,
  confirmController.respondToConfirmation
);

module.exports = router;
