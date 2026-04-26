const { Router } = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const validateMiddleware = require('../middleware/validate.middleware');

const router = Router();

router.post(
  '/register',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('tenantName').notEmpty().withMessage('Tenant name is required'),
  ],
  validateMiddleware,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validateMiddleware,
  authController.login
);

module.exports = router;
