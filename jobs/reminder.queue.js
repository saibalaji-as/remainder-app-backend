const Bull = require('bull');
const redis = require('../config/redis');
const Redis = require('ioredis');

function createRedisClient() {
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: { rejectUnauthorized: false },
    enableReadyCheck: false,
  });
}

const reminderQueue = new Bull('reminders', {
  createClient(type) {
    switch (type) {
      case 'client':
        return redis;
      case 'bclient':
      case 'subscriber':
        return createRedisClient();
      default:
        return redis;
    }
  },
});

module.exports = reminderQueue;
