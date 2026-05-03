const { Router } = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const validateMiddleware = require('../middleware/validate.middleware');

const router = Router();

// Rate limiter with a dedicated MemoryStore so each test run starts with a clean counter.
// Limits to 20 requests per 15-minute window per IP to prevent brute-force attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store: new rateLimit.MemoryStore(),
  message: { error: 'Too many requests, please try again later.' },
});

router.use(authLimiter);

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
