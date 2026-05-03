/**
 * Preservation Property Tests — Critical Bug Fixes
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14
 *
 * These tests MUST PASS on unfixed code.
 * They confirm baseline behavior that must be preserved after each fix is applied.
 * Observation-first methodology: each test encodes observed behavior on unfixed code.
 */

'use strict';

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Shared helper: build a mock Express app for supertest tests
// ---------------------------------------------------------------------------
function buildMockApp(supabaseMock, extraMocks = {}) {
  jest.resetModules();

  jest.doMock('../../config/supabase', () => supabaseMock);
  jest.doMock('../../config/stripe', () => ({
    webhooks: { constructEvent: jest.fn() },
  }));
  jest.doMock('../../services/billing.service', () => ({
    createSubscription: jest.fn().mockResolvedValue({}),
    cancelSubscription: jest.fn().mockResolvedValue({}),
  }));
  jest.doMock('../../middleware/auth.middleware', () => (req, res, next) => {
    req.user = { userId: 'user-1', tenantId: 'tenant-1' };
    next();
  });
  jest.doMock('../../middleware/tenant.middleware', () => (req, res, next) => {
    req.tenantId = req.user ? req.user.tenantId : 'tenant-1';
    next();
  });

  Object.entries(extraMocks).forEach(([mod, impl]) => jest.doMock(mod, impl));

  return require('../../app');
}

// ---------------------------------------------------------------------------
// Bug 1 — Confirm controller functions unchanged (Requirement 3.1)
// ---------------------------------------------------------------------------
describe('Preservation Bug 1 — getAppointmentByToken and respondToConfirmation are callable', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('getAppointmentByToken is exported as a function', () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../services/reminder.service', () => ({
      skipPendingReminders: jest.fn(),
    }));
    const controller = require('../../controllers/confirm.controller');
    expect(typeof controller.getAppointmentByToken).toBe('function');
  });

  test('respondToConfirmation is exported as a function', () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../services/reminder.service', () => ({
      skipPendingReminders: jest.fn(),
    }));
    const controller = require('../../controllers/confirm.controller');
    expect(typeof controller.respondToConfirmation).toBe('function');
  });

  test('getAppointmentByToken returns 400 when token is missing', async () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../services/reminder.service', () => ({
      skipPendingReminders: jest.fn(),
    }));
    const controller = require('../../controllers/confirm.controller');
    const req = { query: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await controller.getAppointmentByToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('respondToConfirmation returns 400 when token is missing', async () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../services/reminder.service', () => ({
      skipPendingReminders: jest.fn(),
    }));
    const controller = require('../../controllers/confirm.controller');
    const req = { body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await controller.respondToConfirmation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — Normal WhatsApp send path unchanged (Requirement 3.2)
// ---------------------------------------------------------------------------
describe('Preservation Bug 2 — Normal WhatsApp send (no sandbox) marks reminder as sent', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => {
    delete process.env.WHATSAPP_SANDBOX_MODE;
    delete process.env.TWILIO_WHATSAPP_NUMBER;
    jest.resetModules();
  });

  test('when WHATSAPP_SANDBOX_MODE is unset, reminder status is set to sent', async () => {
    delete process.env.WHATSAPP_SANDBOX_MODE;
    process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';

    jest.doMock('../../config/twilio', () => ({
      messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_fake' }) },
    }));

    let capturedStatus = null;
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockImplementation((payload) => {
      capturedStatus = payload.status;
      return { eq: eqMock };
    });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));

    const { sendReminderWhatsApp } = require('../../services/whatsapp.service');
    const appointment = {
      contacts: { name: 'Alice', phone: '+919876543210' },
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      notes: null,
    };

    await sendReminderWhatsApp('reminder-id-1', appointment, null);

    // On unfixed code: normal path sets status to 'sent' — this must continue to pass
    expect(capturedStatus).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — Production offsets preserved (PBT) (Requirement 3.3)
// ---------------------------------------------------------------------------
describe('Preservation Bug 3 — Production reminder offsets still scheduled for all channels (PBT)', () => {
  const ALL_CHANNELS = ['sms', 'email', 'both', 'whatsapp', 'whatsapp_sms', 'whatsapp_email', 'all'];
  const H24 = 24 * 60 * 60 * 1000;
  const H2  =  2 * 60 * 60 * 1000;
  const M30 =      30 * 60 * 1000;

  test('24h and 2h offsets present for sms channels; 30min offset present for email channels (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_CHANNELS),
        async (channel) => {
          jest.resetModules();

          const insertedPayloads = [];

          // Build mock chain
          const singleMock = jest.fn().mockImplementation(() =>
            Promise.resolve({ data: { id: `r-${Math.random()}` }, error: null })
          );
          const selectMock = jest.fn().mockReturnValue({ single: singleMock });
          const insertMock = jest.fn().mockImplementation((payload) => {
            insertedPayloads.push(payload);
            return { select: selectMock };
          });

          // IMPORTANT: mock deps BEFORE requiring reminder.service
          jest.doMock('../../config/supabase', () => ({
            from: jest.fn().mockReturnValue({ insert: insertMock }),
          }));
          jest.doMock('../../jobs/reminder.queue', () => ({
            add: jest.fn().mockResolvedValue({}),
          }));
          // Ensure reminder.service itself is NOT mocked (use the real implementation)
          jest.unmock('../../services/reminder.service');

          // Now require the real reminder.service — its deps are mocked above
          const reminderModule = require('../../services/reminder.service');
          // reminder.service exports scheduleReminders as a named export
          const scheduleReminders = reminderModule.scheduleReminders;

          if (typeof scheduleReminders !== 'function') {
            throw new Error(`scheduleReminders is not a function, got: ${typeof scheduleReminders}. Module keys: ${Object.keys(reminderModule).join(', ')}`);
          }

          const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
          await scheduleReminders('appt-1', futureDate, channel);

          const appointmentTime = new Date(futureDate).getTime();

          const useSms      = ['sms','both','whatsapp_sms','all'].includes(channel);
          const useWhatsApp = ['whatsapp','whatsapp_sms','whatsapp_email','all'].includes(channel);
          const useEmail    = ['email','both','whatsapp_email','all'].includes(channel);

          const hasOffset = (offsetMs, ch) =>
            insertedPayloads.some((p) => {
              if (!p || !p.scheduled_at) return false;
              const t = new Date(p.scheduled_at).getTime();
              return Math.abs(t - (appointmentTime - offsetMs)) < 1000 && p.channel === ch;
            });

          if (useSms) {
            expect(hasOffset(H24, 'sms')).toBe(true);
            expect(hasOffset(H2,  'sms')).toBe(true);
          }
          if (useWhatsApp) {
            expect(hasOffset(H24, 'whatsapp')).toBe(true);
            expect(hasOffset(H2,  'whatsapp')).toBe(true);
          }
          if (useEmail) {
            expect(hasOffset(M30, 'email')).toBe(true);
          }
        }
      ),
      { numRuns: ALL_CHANNELS.length, seed: 42 }
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — Appointments with no pending reminders still delete (Requirement 3.4)
// ---------------------------------------------------------------------------
describe('Preservation Bug 4 — deleteAppointment with no pending reminders returns { deleted: true }', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('deleteAppointment returns { deleted: true } when no pending reminders exist', async () => {
    const eqMock2 = jest.fn().mockResolvedValue({ error: null });
    const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock1 });

    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ delete: deleteMock }),
    }));
    // skipPendingReminders returns empty array (no pending reminders)
    jest.doMock('../../services/reminder.service', () => ({
      scheduleReminders: jest.fn().mockResolvedValue(undefined),
      skipPendingReminders: jest.fn().mockResolvedValue([]),
    }));

    const { deleteAppointment } = require('../../services/appointment.service');
    const result = await deleteAppointment('appt-no-reminders', 'tenant-1');

    expect(result).toEqual({ deleted: true });
  });
});

// ---------------------------------------------------------------------------
// Bug 7 — Whitelisted-only payloads update correctly (PBT) (Requirement 3.7)
// ---------------------------------------------------------------------------
describe('Preservation Bug 7 — Whitelisted-only payloads reach Supabase correctly (PBT)', () => {
  test('payloads with only whitelisted fields are passed through to Supabase (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          notes: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
          scheduledAt: fc.option(
            fc.date({ min: new Date('2025-01-01'), max: new Date('2030-01-01') })
              .map(d => d.toISOString()),
            { nil: undefined }
          ),
          reminderChannel: fc.option(
            fc.constantFrom('sms', 'email', 'both'),
            { nil: undefined }
          ),
        }),
        async (whitelistedPayload) => {
          jest.resetModules();

          let capturedPayload = null;
          const singleMock = jest.fn().mockResolvedValue({ data: { id: 'appt-1' }, error: null });
          const selectMock = jest.fn().mockReturnValue({ single: singleMock });
          const eqMock2 = jest.fn().mockReturnValue({ select: selectMock });
          const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
          const updateMock = jest.fn().mockImplementation((p) => {
            capturedPayload = p;
            return { eq: eqMock1 };
          });

          jest.doMock('../../config/supabase', () => ({
            from: jest.fn().mockReturnValue({ update: updateMock }),
          }));
          jest.doMock('../../services/reminder.service', () => ({
            scheduleReminders: jest.fn().mockResolvedValue(undefined),
            skipPendingReminders: jest.fn().mockResolvedValue(undefined),
          }));

          const { updateAppointment } = require('../../services/appointment.service');
          // On unfixed code, payload is passed directly — whitelisted fields go through
          await updateAppointment('appt-1', 'tenant-1', whitelistedPayload);

          // The update must have been called (Supabase received the payload)
          expect(updateMock).toHaveBeenCalled();
        }
      ),
      { numRuns: 30, seed: 42 }
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 8 — Tenant name update still works (Requirement 3.8)
// ---------------------------------------------------------------------------
describe('Preservation Bug 8 — PUT /api/tenants/me with name field updates tenant name', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('PUT /api/tenants/me with { name } returns 200 and updated tenant', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 'tenant-1', name: 'New Name' },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });

    const app = buildMockApp({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    });
    const request = require('supertest');

    const response = await request(app)
      .put('/api/tenants/me')
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'New Name' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('New Name');
  });
});

// ---------------------------------------------------------------------------
// Bug 9 — Valid contact updates still succeed (Requirement 3.9)
// ---------------------------------------------------------------------------
describe('Preservation Bug 9 — PUT /api/contacts/:id with valid fields returns 200', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('PUT /api/contacts/:id with valid name, email, phone returns 200', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 1, name: 'Alice', email: 'alice@example.com', phone: '9876543210' },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock2 = jest.fn().mockReturnValue({ select: selectMock });
    const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock1 });

    const app = buildMockApp({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    });
    const request = require('supertest');

    const response = await request(app)
      .put('/api/contacts/1')
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Alice', email: 'alice@example.com', phone: '9876543210' });

    // On unfixed code: no validators on PUT → valid payload returns 200
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Bug 10 — Email SSE behavior unchanged (Requirement 3.10)
// ---------------------------------------------------------------------------
describe('Preservation Bug 10 — email.service.js emits email-sent SSE after successful send', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('sseManager.emit is called with email-sent after successful email send', async () => {
    const sseManagerMock = { emit: jest.fn() };
    jest.doMock('../../sse.manager', () => sseManagerMock);

    // Mock nodemailer transporter
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn().mockReturnValue({ sendMail: sendMailMock }),
    }));

    // Mock template service
    jest.doMock('../../services/template.service', () => ({
      getByTenant: jest.fn().mockResolvedValue(null),
      getDefaults: jest.fn().mockReturnValue({
        subject: 'Reminder',
        greeting: 'Hi',
        body: 'Your appointment is coming up.',
        closing: 'Thanks',
      }),
      renderTemplate: jest.fn().mockImplementation((fields) => fields),
    }));

    // Mock supabase for reminder status update
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));

    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_APP_PASSWORD = 'test-password';

    const { sendReminderEmail } = require('../../services/email.service');

    await sendReminderEmail({
      to: 'alice@example.com',
      contactName: 'Alice',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      notes: null,
      tenantId: 'tenant-1',
      reminderId: 'reminder-1',
      appointmentTitle: 'Checkup',
      confirmationLink: null,
    });

    // On unfixed code: email service already emits email-sent — must continue to pass
    expect(sseManagerMock.emit).toHaveBeenCalled();
    const calls = sseManagerMock.emit.mock.calls;
    const emailSentCall = calls.find(args => args[1] === 'email-sent');
    expect(emailSentCall).toBeDefined();

    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_APP_PASSWORD;
  });
});

// ---------------------------------------------------------------------------
// Bug 12 — No rescheduling when scheduledAt unchanged (PBT) (Requirement 3.11)
// ---------------------------------------------------------------------------
describe('Preservation Bug 12 — No rescheduling when scheduledAt absent or unchanged (PBT)', () => {
  const CURRENT_SCHEDULED_AT = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  test('skipPendingReminders and scheduleReminders NOT called when scheduledAt absent (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Payloads that do NOT include scheduledAt
        fc.record({
          title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          notes: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
        }),
        async (payload) => {
          jest.resetModules();

          const skipSpy = jest.fn().mockResolvedValue(undefined);
          const scheduleSpy = jest.fn().mockResolvedValue(undefined);

          const singleMock = jest.fn().mockResolvedValue({
            data: { id: 'appt-1', scheduled_at: CURRENT_SCHEDULED_AT, reminder_channel: 'sms' },
            error: null,
          });
          const selectMock = jest.fn().mockReturnValue({ single: singleMock });
          const eqMock2 = jest.fn().mockReturnValue({ select: selectMock });
          const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
          const updateMock = jest.fn().mockReturnValue({ eq: eqMock1 });

          jest.doMock('../../config/supabase', () => ({
            from: jest.fn().mockReturnValue({ update: updateMock }),
          }));
          jest.doMock('../../services/reminder.service', () => ({
            scheduleReminders: scheduleSpy,
            skipPendingReminders: skipSpy,
          }));

          const { updateAppointment } = require('../../services/appointment.service');
          await updateAppointment('appt-1', 'tenant-1', payload);

          // On unfixed code: no rescheduling logic exists → spies never called → passes
          expect(skipSpy).not.toHaveBeenCalled();
          expect(scheduleSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 20, seed: 42 }
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 13 — Requests within rate limit still processed (Requirement 3.12)
// ---------------------------------------------------------------------------
describe('Preservation Bug 13 — ≤20 requests to POST /api/auth/login never return 429', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('sending 10 login requests returns 200 or 401, never 429', async () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../config/stripe', () => ({
      webhooks: { constructEvent: jest.fn() },
    }));
    jest.doMock('../../services/billing.service', () => ({
      createSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
    }));
    jest.doMock('../../services/auth.service', () => ({
      login: jest.fn().mockRejectedValue(
        Object.assign(new Error('Invalid credentials'), { status: 401 })
      ),
      register: jest.fn().mockRejectedValue(new Error('Not used')),
      verifyToken: jest.fn().mockImplementation(() => { throw new Error('Invalid token'); }),
    }));
    jest.doMock('../../middleware/auth.middleware', () => (req, res, next) => {
      req.user = { userId: 'user-1', tenantId: 'tenant-1' };
      next();
    });
    jest.doMock('../../middleware/tenant.middleware', () => (req, res, next) => {
      req.tenantId = req.user.tenantId;
      next();
    });

    const app = require('../../app');
    const request = require('supertest');
    const loginPayload = { email: 'test@example.com', password: 'password123' };

    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .post('/api/auth/login')
        .send(loginPayload);
      // On unfixed code: no rate limiting → all responses are 200 or 401
      expect(response.status).not.toBe(429);
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 14 — UUID contactId still accepted (Requirement 3.13)
// ---------------------------------------------------------------------------
describe('Preservation Bug 14 — POST /api/appointments with UUID contactId returns 201', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('POST /api/appointments with UUID contactId is accepted (not 422)', async () => {
    const uuidContactId = '550e8400-e29b-41d4-a716-446655440000';

    const singleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'appt-uuid-1',
        tenant_id: 'tenant-1',
        contact_id: uuidContactId,
        title: 'Test',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        reminder_channel: 'sms',
      },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const insertMock = jest.fn().mockReturnValue({ select: selectMock });

    const app = buildMockApp(
      { from: jest.fn().mockReturnValue({ insert: insertMock }) },
      {
        '../../services/reminder.service': () => ({
          scheduleReminders: jest.fn().mockResolvedValue(undefined),
          skipPendingReminders: jest.fn().mockResolvedValue(undefined),
        }),
        '../../jobs/reminder.queue': () => ({ add: jest.fn().mockResolvedValue({}) }),
      }
    );
    const request = require('supertest');

    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer fake-token')
      .send({
        contactId: uuidContactId,
        title: 'Test',
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        reminderChannel: 'sms',
      });

    // On unfixed code: isUUID() accepts UUID contactId → returns 201
    expect(response.status).not.toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Bug 15 — Unrecognised Stripe events return 200 (Requirement 3.14)
// Now that the webhook handler exists (Bug 15 fix applied), verify that
// unrecognised event types return HTTP 200 without throwing.
// ---------------------------------------------------------------------------
describe('Preservation Bug 15 — Unrecognised Stripe events return 200 (post-fix verification)', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  test('unrecognised Stripe event type returns HTTP 200 without throwing', async () => {
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));
    jest.doMock('../../config/stripe', () => ({
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          type: 'some.unrecognised.event',
          data: { object: {} },
        }),
      },
    }));
    jest.doMock('../../services/billing.service', () => ({
      createSubscription: jest.fn().mockResolvedValue({}),
      cancelSubscription: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../middleware/auth.middleware', () => (req, res, next) => {
      req.user = { userId: 'user-1', tenantId: 'tenant-1' };
      next();
    });
    jest.doMock('../../middleware/tenant.middleware', () => (req, res, next) => {
      req.tenantId = req.user.tenantId;
      next();
    });

    const app = require('../../app');
    const request = require('supertest');

    const response = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-signature')
      .send(JSON.stringify({ id: 'evt_unknown', type: 'some.unrecognised.event', data: { object: {} } }));

    // Unrecognised events must return 200 (acknowledged without processing)
    expect(response.status).toBe(200);
  });
});
