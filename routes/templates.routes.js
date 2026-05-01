const { Router } = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const templatesController = require('../controllers/templates.controller');

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.get('/', templatesController.getTemplate);
router.post(
  '/',
  body('subject').trim().isLength({ min: 1, max: 150 }),
  templatesController.saveTemplate
);

module.exports = router;
