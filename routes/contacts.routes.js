const { Router } = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const contactsController = require('../controllers/contacts.controller');

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.post(
  '/',
  [
    body('name').notEmpty(),
    body('email').isEmail(),
    body('phone').notEmpty(),
  ],
  validateMiddleware,
  contactsController.create
);

router.get('/', contactsController.list);

router.get('/:id', contactsController.getById);

router.put('/:id', contactsController.update);

router.delete('/:id', contactsController.remove);

module.exports = router;
