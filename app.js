const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const contactsRoutes = require('./routes/contacts.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const remindersRoutes = require('./routes/reminders.routes');
const billingRoutes = require('./routes/billing.routes');

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/billing', billingRoutes);

if (process.env.NODE_ENV !== 'production') {
  const testRoutes = require('./routes/test.routes');
  app.use('/api/test', testRoutes);
}

module.exports = app;
