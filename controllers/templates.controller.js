const { validationResult } = require('express-validator');
const templateService = require('../services/template.service');

async function getTemplate(req, res, next) {
  try {
    const result = await templateService.getByTenant(req.tenantId);
    if (result === null) {
      return res.json(templateService.getDefaults());
    }
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function saveTemplate(req, res, next) {
  try {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(422).json({ errors: result.array() });
    }

    const { subject, greeting, body, closing } = req.body;
    const saved = await templateService.upsert(req.tenantId, { subject, greeting, body, closing });
    return res.json(saved);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getTemplate, saveTemplate };
