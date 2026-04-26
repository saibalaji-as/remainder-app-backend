const { Router } = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth.middleware');
const tenantMiddleware = require('../middleware/tenant.middleware');

const router = Router();

// GET /me — return the tenant profile for the authenticated tenant
router.get('/me', [authMiddleware, tenantMiddleware], async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', req.tenantId)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

// PUT /me — update tenant fields scoped to req.tenantId
router.put('/me', [authMiddleware, tenantMiddleware], async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .update(req.body)
      .eq('id', req.tenantId)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
