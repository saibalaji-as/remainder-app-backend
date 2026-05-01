const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const remindersController = require('../controllers/reminders.controller');

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.get('/', remindersController.list);
router.get('/:id', remindersController.getById);
router.post('/:id/retry', remindersController.retry);

module.exports = router;
