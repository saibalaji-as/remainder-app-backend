const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');
const statsController = require('../controllers/statsController');

const router = Router();

router.use(authMiddleware, tenantMiddleware);
router.get('/stats', statsController.getDashboardStats);

module.exports = router;
