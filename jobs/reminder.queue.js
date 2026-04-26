const Bull = require('bull');
const redisConfig = require('../config/redis');

const queue = new Bull('reminders', { redis: redisConfig });

async function addReminderJob(data, delayMs) {
  return queue.add(data, { attempts: 3, delay: delayMs });
}

module.exports = { queue, addReminderJob };
