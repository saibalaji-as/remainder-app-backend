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
  require('./jobs/reminder.processor');
  console.log('⚙️ Reminder job processor started');
});

module.exports = app;
