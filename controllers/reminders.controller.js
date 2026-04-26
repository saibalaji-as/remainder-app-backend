const reminderService = require('../services/reminder.service');

async function list(req, res, next) {
  try {
    const reminders = await reminderService.list(req.tenantId);
    return res.json(reminders);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const reminder = await reminderService.getById(req.tenantId, req.params.id);
    if (!reminder) return res.status(404).json({ message: 'Not found' });
    return res.json(reminder);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById };
