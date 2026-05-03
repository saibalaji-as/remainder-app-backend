const { Router } = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const appointmentsController = require('../controllers/appointments.controller');

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.post(
  '/',
  [
    body('contactId').notEmpty(),
    body('title').notEmpty(),
    body('scheduledAt').isISO8601(),
    body('reminderChannel').isIn(['sms', 'email', 'both', 'whatsapp', 'whatsapp_sms', 'whatsapp_email', 'all']),
    body('notes').optional().isString().isLength({ max: 500 }),
  ],
  validateMiddleware,
  appointmentsController.create
);

router.get('/', appointmentsController.list);
router.get('/:id', appointmentsController.getById);
router.put(
  '/:id',
  [body('notes').optional().isString().isLength({ max: 500 })],
  validateMiddleware,
  appointmentsController.update
);
router.delete('/:id', appointmentsController.remove);

router.patch(
  '/:id/status',
  [body('status').isIn(['confirmed', 'cancelled', 'completed'])],
  validateMiddleware,
  appointmentsController.updateStatus
);

module.exports = router;
