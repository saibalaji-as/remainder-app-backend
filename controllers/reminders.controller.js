const reminderService = require('../services/reminder.service');
const sseManager = require('../sse.manager');

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

async function retry(req, res, next) {
  try {
    const result = await reminderService.retryReminder(req.tenantId, req.params.id);
    if (result === null) return res.status(404).json({ message: 'Not found' });
    return res.json(result);
  } catch (err) {
    if (err && err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    return next(err);
  }
}

function stream(req, res, next) {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
    res.flushHeaders();

    sseManager.addClient(req.tenantId, res);

    // Send a keepalive comment every 25s to prevent proxies/browsers
    // from closing the connection due to inactivity (504 timeout)
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepalive);
      sseManager.removeClient(req.tenantId, res);
    });

    res.write('event: connected\ndata: {}\n\n');
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, retry, stream };
