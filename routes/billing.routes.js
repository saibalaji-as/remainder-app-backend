const { Router } = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const billingService = require('../services/billing.service');

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.post(
  '/subscribe',
  [
    body('priceId').notEmpty(),
    body('paymentMethodId').notEmpty(),
  ],
  validateMiddleware,
  async (req, res) => {
    try {
      const record = await billingService.createSubscription({
        tenantId: req.tenantId,
        ...req.body,
      });
      return res.status(200).json(record);
    } catch (err) {
      return res.status(402).json({ error: err.message });
    }
  }
);

router.delete('/subscribe', async (req, res) => {
  try {
    const record = await billingService.cancelSubscription({ tenantId: req.tenantId });
    return res.status(200).json(record);
  } catch (err) {
    return res.status(402).json({ error: err.message });
  }
});

module.exports = router;
