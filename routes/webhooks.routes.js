const { Router } = require('express');
const express = require('express');
const webhooksController = require('../controllers/webhooks.controller');

const router = Router();

router.post(
  '/twilio/sms-status',
  express.urlencoded({ extended: false }),
  webhooksController.twilioSmsStatus
);

module.exports = router;
