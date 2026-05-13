require('dotenv').config();

const app = require('./app');

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Warn early if email credentials are missing
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    console.warn('⚠️  EMAIL_USER or EMAIL_APP_PASSWORD is not set — email reminders will fail');
  } else {
    console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`);
  }

  // Load processor to start consuming jobs
  console.log('Loading reminder processor...');
  require('./jobs/reminder.processor');
  console.log('⚙️ Reminder job processor started');

  const { startNudgeJob } = require('./jobs/nudge.job');
  startNudgeJob();
  console.log('⏰ Nudge job started (5-minute interval)');

  // Keep-alive ping — prevents Render free tier from spinning down.
  // Render spins down after 15min of inactivity; a cold start causes SMTP
  // connection timeouts when reminder jobs fire. Ping every 10 minutes.
  if (process.env.BACKEND_URL && process.env.NODE_ENV === 'production') {
    const https = require('https');
    setInterval(() => {
      https.get(`${process.env.BACKEND_URL}/health`, (res) => {
        console.log(`🏓 Keep-alive ping: ${res.statusCode}`);
      }).on('error', (err) => {
        console.warn('⚠️  Keep-alive ping failed:', err.message);
      });
    }, 10 * 60 * 1000); // every 10 minutes
    console.log('🏓 Keep-alive ping started (10-minute interval)');
  }
});

module.exports = app;
