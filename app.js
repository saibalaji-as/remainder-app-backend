const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const contactsRoutes = require('./routes/contacts.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const remindersRoutes = require('./routes/reminders.routes');
const billingRoutes = require('./routes/billing.routes');
const statsRoutes = require('./routes/stats');
const templatesRoutes = require('./routes/templates.routes');
const confirmRoutes = require('./routes/confirm.routes');
const pushRoutes = require('./routes/push.routes');

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map(o => o.trim());

console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    console.log('CORS request from origin:', origin);
    // allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS blocked: ${origin} not in allowed list`);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
// Stripe webhook — must be registered BEFORE express.json() to receive the raw body
// for signature verification. express.json() would consume and discard the raw bytes.
const { webhookHandler } = require('./routes/billing.routes');
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json());

// handle preflight for all routes
app.options('*', cors());

// Public routes — no auth middleware (must be registered before auth-protected routes)
app.use('/api/confirm', confirmRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/dashboard', statsRoutes);
app.use('/api/email-templates', templatesRoutes);
app.use('/api/push', pushRoutes);

// SSE endpoint — must be registered after CORS/auth middleware
const authMiddleware = require('./middleware/auth.middleware');
const tenantMiddleware = require('./middleware/tenant.middleware');
const remindersController = require('./controllers/reminders.controller');
app.get('/api/sse/reminders', authMiddleware, tenantMiddleware, remindersController.stream);

if (process.env.NODE_ENV !== 'production') {
  const testRoutes = require('./routes/test.routes');
  app.use('/api/test', testRoutes);
}

module.exports = app;
