/**
 * Bug Condition Exploration Tests — All 15 Bugs
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 1.12, 1.13, 1.14, 1.15**
 *
 * CRITICAL: These tests MUST FAIL on unfixed code — failure confirms each bug exists.
 * DO NOT attempt to fix the tests or the code when they fail.
 * These tests encode the expected behavior — they will validate the fixes when they pass.
 * GOAL: Surface counterexamples that demonstrate each bug exists.
 *
 * Scoped PBT Approach: For deterministic bugs (3, 7, 12), scope properties to
 * concrete failing cases for reproducibility.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const fc = require('fast-check');

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper: build a mock app with all required mocks for supertest tests
// ─────────────────────────────────────────────────────────────────────────────
function buildMockApp(overrides = {}) {
  // Must mock stripe config BEFORE loading app to prevent env var throw
  jest.doMock('../../config/stripe', () => ({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_123', customer: 'cus_123' } },
      }),
    },
  }));

  jest.doMock('../../services/billing.service', () => ({
    createSubscription: jest.fn().mockResolvedValue({}),
    cancelSubscription: jest.fn().mockResolvedValue({}),
    handleWebhookEvent: jest.fn().mockResolvedValue({}),
  }));

  jest.doMock('../../middleware/auth.middleware', () => (req, res, next) => {
    req.user = { userId: 'user-1', tenantId: 'tenant-1' };
    next();
  });

  jest.doMock('../../middleware/tenant.middleware', () => (req, res, next) => {
    req.tenantId = req.user.tenantId;
    next();
  });

  // Apply any overrides
  Object.entries(overrides).forEach(([modulePath, mockImpl]) => {
    jest.doMock(modulePath, mockImpl);
  });

  return require('../../app');
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 — Export order in confirm.controller.js
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 1 — Export order: module.exports must appear AFTER redirectByAppointmentId definition', () => {
  test('module.exports.redirectByAppointmentId is a function', () => {
    jest.resetModules();
    // Mock supabase to prevent env var throw when loading the controller
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../services/reminder.service', () => ({
      skipPendingReminders: jest.fn(),
    }));

    const controller = require('../../controllers/confirm.controller');
    // On unfixed code: due to hoisting this actually works at runtime,
    // but the line-order test below catches the structural bug.
    expect(typeof controller.redirectByAppointmentId).toBe('function');
  });

  test('source file: module.exports line appears AFTER redirectByAppointmentId function definition', () => {
    const filePath = path.resolve(__dirname, '../../controllers/confirm.controller.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split('\n');

    // Find the line index of module.exports assignment that includes redirectByAppointmentId
    const exportsLineIndex = lines.findIndex(line =>
      line.includes('module.exports') && line.includes('redirectByAppointmentId')
    );

    // Find the line index where redirectByAppointmentId function is defined
    const funcDefLineIndex = lines.findIndex(line =>
      /^async function redirectByAppointmentId/.test(line.trim()) ||
      /^function redirectByAppointmentId/.test(line.trim()) ||
      /^const redirectByAppointmentId\s*=/.test(line.trim())
    );

    expect(exportsLineIndex).toBeGreaterThan(-1); // exports line must exist
    expect(funcDefLineIndex).toBeGreaterThan(-1);  // function definition must exist

    // On unfixed code: exportsLineIndex (143) < funcDefLineIndex (152) → this assertion FAILS
    expect(exportsLineIndex).toBeGreaterThan(funcDefLineIndex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2 — WhatsApp silent failure: sandbox mode should NOT mark status as 'sent'
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 2 — WhatsApp silent failure: WHATSAPP_SANDBOX_MODE=true must NOT set status to sent', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.WHATSAPP_SANDBOX_MODE;
    delete process.env.TWILIO_WHATSAPP_NUMBER;
    jest.resetModules();
  });

  test('when WHATSAPP_SANDBOX_MODE=true, reminder status must NOT be set to sent', async () => {
    // Mock twilio client — returns a fake SID (simulates sandbox accepting the call)
    jest.doMock('../../config/twilio', () => ({
      messages: {
        create: jest.fn().mockResolvedValue({ sid: 'SM_fake_sid_12345' }),
      },
    }));

    // Capture what status is written to Supabase
    let capturedStatus = null;
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockImplementation((updatePayload) => {
      capturedStatus = updatePayload.status;
      return { eq: eqMock };
    });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));

    process.env.WHATSAPP_SANDBOX_MODE = 'true';
    process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';

    const { sendReminderWhatsApp } = require('../../services/whatsapp.service');

    const appointment = {
      contacts: { name: 'Alice', phone: '+919876543210' },
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      notes: null,
    };

    await sendReminderWhatsApp('reminder-id-1', appointment, null);

    // On unfixed code: capturedStatus === 'sent' → this assertion FAILS
    expect(capturedStatus).not.toBe('sent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3 — Test offsets (PBT): no reminder should have offsetMs = 2 * 60 * 1000
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 3 — Test offsets: scheduleReminders must NOT produce 2-minute offsets (PBT)', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * Property: For all valid reminder channels, scheduleReminders must not
   * produce any reminder with offsetMs = 2 * 60 * 1000 (2 minutes).
   * On unfixed code, this assertion fails for every channel that includes
   * sms, whatsapp, or email.
   *
   * Counterexample: channel = 'sms' → insert called with scheduled_at 2 minutes before appointment
   *
   * Scoped PBT: Uses fc.constantFrom over all channels for deterministic reproduction.
   */

  const ALL_CHANNELS = ['sms', 'email', 'both', 'whatsapp', 'whatsapp_sms', 'whatsapp_email', 'all'];
  const TEST_OFFSET_MS = 2 * 60 * 1000;

  test('no reminder has offsetMs = 2 * 60 * 1000 for any channel (PBT over all channels)', async () => {
    // Run the property check for each channel using fast-check
    // We set up mocks fresh for each channel iteration
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_CHANNELS),
        async (channel) => {
          // Fresh module registry for each property run
          jest.resetModules();

          const insertedPayloads = [];

          // Build the mock chain fresh each time
          const singleMock = jest.fn().mockImplementation(() =>
            Promise.resolve({ data: { id: `r-${Date.now()}` }, error: null })
          );
          const selectMock = jest.fn().mockReturnValue({ single: singleMock });
          const captureInsert = jest.fn().mockImplementation((payload) => {
            insertedPayloads.push(payload);
            return { select: selectMock };
          });
          const fromMock = jest.fn().mockReturnValue({ insert: captureInsert });

          jest.doMock('../../config/supabase', () => ({ from: fromMock }));
          jest.doMock('../../jobs/reminder.queue', () => ({ add: jest.fn().mockResolvedValue({}) }));
          // Ensure reminder.service itself is NOT mocked (use the real implementation)
          jest.unmock('../../services/reminder.service');

          // Require AFTER mocks are set up
          const reminderService = require('../../services/reminder.service');
          const scheduleReminders = reminderService.scheduleReminders;

          // Use a future date far enough that all reminders have positive delay
          const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
          await scheduleReminders('appt-id-1', futureDate, channel);

          // Check if any inserted reminder has the 2-minute test offset
          const appointmentTime = new Date(futureDate).getTime();
          const testOffsetTime = appointmentTime - TEST_OFFSET_MS;

          const hasTestOffset = insertedPayloads.some((payload) => {
            if (!payload || !payload.scheduled_at) return false;
            const insertedTime = new Date(payload.scheduled_at).getTime();
            return Math.abs(insertedTime - testOffsetTime) < 1000;
          });

          // On unfixed code: hasTestOffset === true → this assertion FAILS
          expect(hasTestOffset).toBe(false);
        }
      ),
      { numRuns: ALL_CHANNELS.length, seed: 42 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 4 — Delete without cancel: skipPendingReminders must be called on delete
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 4 — Delete without cancel: deleteAppointment must call skipPendingReminders', () => {
  let deleteAppointment;
  let skipPendingRemindersSpy;

  beforeEach(() => {
    jest.resetModules();

    const eqMock2 = jest.fn().mockResolvedValue({ error: null });
    const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock1 });

    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ delete: deleteMock }),
    }));

    // Mock reminder.service to spy on skipPendingReminders
    jest.doMock('../../services/reminder.service', () => ({
      scheduleReminders: jest.fn().mockResolvedValue(undefined),
      skipPendingReminders: jest.fn().mockResolvedValue([
        { id: 'r1', status: 'skipped' },
        { id: 'r2', status: 'skipped' },
      ]),
    }));

    const reminderService = require('../../services/reminder.service');
    skipPendingRemindersSpy = reminderService.skipPendingReminders;
    ({ deleteAppointment } = require('../../services/appointment.service'));
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('skipPendingReminders is called when deleteAppointment is invoked', async () => {
    await deleteAppointment('appt-id-1', 'tenant-id-1');

    // On unfixed code: skipPendingReminders is never called → this assertion FAILS
    expect(skipPendingRemindersSpy).toHaveBeenCalledWith('appt-id-1');
  });

  test('all pending reminders have status skipped after deleteAppointment', async () => {
    await deleteAppointment('appt-id-1', 'tenant-id-1');

    // Verify the spy was called and would return skipped reminders
    const result = await skipPendingRemindersSpy.mock.results[0]?.value;
    if (result && Array.isArray(result)) {
      result.forEach(r => expect(r.status).toBe('skipped'));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 7 — Mass assignment (PBT): only whitelisted snake_case fields must reach Supabase
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 7 — Mass assignment: updateAppointment must only pass whitelisted snake_case fields (PBT)', () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * Property: For all payloads containing non-whitelisted fields, the Supabase
   * .update() call must only receive whitelisted snake_case fields:
   * ['title', 'notes', 'scheduled_at', 'reminder_channel'].
   * On unfixed code, non-whitelisted fields pass through.
   *
   * Counterexample: { tenant_id: null, contact_id: null, confirmation_token: null, ... }
   * → Supabase receives all fields including tenant_id
   */

  const NON_WHITELISTED = ['tenant_id', 'contact_id', 'confirmation_token', 'id', 'status', 'created_at'];

  test('non-whitelisted fields must NOT reach Supabase .update() (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate payloads that include at least one non-whitelisted field
        fc.record({
          title: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          notes: fc.option(fc.string({ minLength: 0, maxLength: 200 })),
          scheduledAt: fc.option(
            fc.date({ min: new Date('2025-01-01'), max: new Date('2030-01-01') })
              .map(d => d.toISOString())
          ),
          reminderChannel: fc.option(fc.constantFrom('sms', 'email', 'both')),
          tenant_id: fc.option(fc.uuid()),
          contact_id: fc.option(fc.integer({ min: 1, max: 9999 })),
          confirmation_token: fc.option(fc.string({ minLength: 10, maxLength: 50 })),
        }),
        async (payload) => {
          jest.resetModules();

          let capturedUpdatePayload = null;
          const singleMock = jest.fn().mockResolvedValue({ data: { id: 'appt-1' }, error: null });
          const selectMock = jest.fn().mockReturnValue({ single: singleMock });
          const eqMock2 = jest.fn().mockReturnValue({ select: selectMock });
          const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
          const updateMock = jest.fn().mockImplementation((updatePayload) => {
            capturedUpdatePayload = updatePayload;
            return { eq: eqMock1 };
          });

          jest.doMock('../../config/supabase', () => ({
            from: jest.fn().mockReturnValue({ update: updateMock, select: selectMock }),
          }));
          jest.doMock('../../services/reminder.service', () => ({
            scheduleReminders: jest.fn().mockResolvedValue(undefined),
            skipPendingReminders: jest.fn().mockResolvedValue(undefined),
          }));

          const { updateAppointment } = require('../../services/appointment.service');
          await updateAppointment('appt-1', 'tenant-1', payload);

          if (capturedUpdatePayload !== null) {
            const capturedKeys = Object.keys(capturedUpdatePayload);

            // Assert: no non-whitelisted fields in the update payload
            for (const nonWhitelisted of NON_WHITELISTED) {
              // On unfixed code: non-whitelisted fields ARE present → this assertion FAILS
              expect(capturedKeys).not.toContain(nonWhitelisted);
            }

            // Assert: no camelCase keys (scheduledAt, reminderChannel) in the update payload
            // On unfixed code: camelCase keys ARE present → this assertion FAILS
            expect(capturedKeys).not.toContain('scheduledAt');
            expect(capturedKeys).not.toContain('reminderChannel');
          }
        }
      ),
      { numRuns: 50, seed: 42 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 8 — Tenant mass assignment: PUT /api/tenants/me must only pass 'name'
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 8 — Tenant mass assignment: PUT /api/tenants/me must only pass whitelisted fields', () => {
  /**
   * **Validates: Requirements 1.8**
   *
   * Property: When PUT /api/tenants/me is called with non-whitelisted fields
   * (plan, stripe_customer_id), only { name } must reach Supabase .update().
   * On unfixed code, all fields pass through.
   */

  let capturedUpdatePayload;

  beforeEach(() => {
    jest.resetModules();
    capturedUpdatePayload = null;
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('plan and stripe_customer_id must NOT reach Supabase .update()', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: { id: 'tenant-1', name: 'Test' }, error: null });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockImplementation((payload) => {
      capturedUpdatePayload = payload;
      return { eq: eqMock };
    });

    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock, select: selectMock }),
    }));

    const app = buildMockApp();
    const request = require('supertest');

    const response = await request(app)
      .put('/api/tenants/me')
      .set('Authorization', 'Bearer fake-token')
      .send({ plan: 'enterprise', stripe_customer_id: 'cus_attacker' });

    // The request should succeed (not 5xx)
    expect(response.status).toBeLessThan(500);

    if (capturedUpdatePayload !== null) {
      // On unfixed code: plan and stripe_customer_id ARE in the payload → these assertions FAIL
      expect(capturedUpdatePayload).not.toHaveProperty('plan');
      expect(capturedUpdatePayload).not.toHaveProperty('stripe_customer_id');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 9 — Contact validation: PUT /api/contacts/:id with invalid email → HTTP 422
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 9 — Contact validation: PUT /api/contacts/:id with invalid email must return 422', () => {
  /**
   * **Validates: Requirements 1.9**
   *
   * On unfixed code: PUT /api/contacts/:id has no validators → returns HTTP 200.
   * Expected: returns HTTP 422.
   */

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('PUT /api/contacts/:id with invalid email returns HTTP 422', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: { id: 1, name: 'Alice' }, error: null });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock2 = jest.fn().mockReturnValue({ select: selectMock });
    const eqMock1 = jest.fn().mockReturnValue({ eq: eqMock2 });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock1 });

    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock, select: selectMock }),
    }));

    const app = buildMockApp();
    const request = require('supertest');

    const response = await request(app)
      .put('/api/contacts/1')
      .set('Authorization', 'Bearer fake-token')
      .send({ email: 'not-an-email' });

    // On unfixed code: no validators → returns 200 → this assertion FAILS
    expect(response.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 10 — WhatsApp SSE not emitted: sseManager.emit must be called with 'whatsapp-sent'
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 10 — WhatsApp SSE not emitted: sseManager.emit must be called after successful send', () => {
  /**
   * **Validates: Requirements 1.10**
   *
   * On unfixed code: sseManager.emit is never called after a WhatsApp send.
   * Expected: sseManager.emit is called with 'whatsapp-sent'.
   */

  let sendReminderWhatsApp;
  let sseManagerEmitSpy;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../config/twilio', () => ({
      messages: {
        create: jest.fn().mockResolvedValue({ sid: 'SM_fake_sid' }),
      },
    }));

    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));

    // Spy on sseManager.emit
    const sseManagerMock = { emit: jest.fn() };
    jest.doMock('../../sse.manager', () => sseManagerMock);

    process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
    delete process.env.WHATSAPP_SANDBOX_MODE;

    ({ sendReminderWhatsApp } = require('../../services/whatsapp.service'));
    sseManagerEmitSpy = require('../../sse.manager').emit;
  });

  afterEach(() => {
    jest.resetModules();
    delete process.env.TWILIO_WHATSAPP_NUMBER;
  });

  test('sseManager.emit is called with whatsapp-sent after successful send', async () => {
    const appointment = {
      contacts: { name: 'Alice', phone: '+919876543210' },
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      notes: null,
      tenant_id: 'tenant-1',
    };

    await sendReminderWhatsApp('reminder-id-1', appointment, null);

    // On unfixed code: sseManager.emit is never called → this assertion FAILS
    expect(sseManagerEmitSpy).toHaveBeenCalled();
    const callArgs = sseManagerEmitSpy.mock.calls;
    const whatsappSentCall = callArgs.find(args =>
      args.includes('whatsapp-sent') || (args[1] && args[1] === 'whatsapp-sent')
    );
    expect(whatsappSentCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 12 — No rescheduling (PBT): updateAppointment with changed scheduled_at
//           must call skipPendingReminders AND scheduleReminders
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 12 — No rescheduling: updateAppointment must reschedule when scheduled_at changes (PBT)', () => {
  /**
   * **Validates: Requirements 1.12**
   *
   * Property 1: For all future scheduledAt values different from the current
   * appointment value, updateAppointment with scheduled_at in the payload must
   * call both skipPendingReminders and scheduleReminders.
   * On unfixed code: neither spy is called.
   *
   * Counterexample: scheduled_at = '2026-05-03T18:17:39.154Z' → neither spy called
   *
   * Property 2 (regression guard): When scheduled_at is ABSENT from the payload,
   * neither spy is called.
   */

  const CURRENT_SCHEDULED_AT = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  test('skipPendingReminders and scheduleReminders are called when scheduled_at changes (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate future dates different from CURRENT_SCHEDULED_AT
        fc.date({ min: new Date(Date.now() + 24 * 60 * 60 * 1000), max: new Date('2030-01-01') })
          .map(d => d.toISOString())
          .filter(d => d !== CURRENT_SCHEDULED_AT),
        async (newScheduledAt) => {
          jest.resetModules();

          const skipSpy = jest.fn().mockResolvedValue(undefined);
          const scheduleSpy = jest.fn().mockResolvedValue(undefined);

          // Mock supabase to return the current appointment with old scheduled_at
          const singleMock = jest.fn().mockResolvedValue({
            data: {
              id: 'appt-1',
              scheduled_at: CURRENT_SCHEDULED_AT,
              reminder_channel: 'sms',
              tenant_id: 'tenant-1',
            },
            error: null,
          });
          // Update chain: update().eq().eq().select().single()
          const selectAfterUpdate = jest.fn().mockReturnValue({ single: singleMock });
          const updateEq2 = jest.fn().mockReturnValue({ select: selectAfterUpdate });
          const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
          const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });
          // Pre-fetch chain: select().eq().eq().single()
          const prefetchEq2 = jest.fn().mockReturnValue({ single: singleMock });
          const prefetchEq1 = jest.fn().mockReturnValue({ eq: prefetchEq2 });
          const selectMock = jest.fn().mockReturnValue({ eq: prefetchEq1 });

          jest.doMock('../../config/supabase', () => ({
            from: jest.fn().mockReturnValue({ update: updateMock, select: selectMock }),
          }));
          jest.doMock('../../services/reminder.service', () => ({
            scheduleReminders: scheduleSpy,
            skipPendingReminders: skipSpy,
          }));

          const { updateAppointment } = require('../../services/appointment.service');

          // Pass snake_case scheduled_at (as produced by Bug 7 fix)
          await updateAppointment('appt-1', 'tenant-1', { scheduled_at: newScheduledAt });

          // On unfixed code: neither spy is called → these assertions FAIL
          expect(skipSpy).toHaveBeenCalledWith('appt-1');
          expect(scheduleSpy).toHaveBeenCalled();
        }
      ),
      { numRuns: 20, seed: 42 }
    );
  });

  test('regression guard: skipPendingReminders and scheduleReminders are NOT called when scheduled_at is absent', async () => {
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
      from: jest.fn().mockReturnValue({ update: updateMock, select: selectMock }),
    }));
    jest.doMock('../../services/reminder.service', () => ({
      scheduleReminders: scheduleSpy,
      skipPendingReminders: skipSpy,
    }));

    const { updateAppointment } = require('../../services/appointment.service');

    // Payload without scheduled_at — only title changes
    await updateAppointment('appt-1', 'tenant-1', { title: 'New Title' });

    // Neither spy should be called when scheduled_at is absent
    expect(skipSpy).not.toHaveBeenCalled();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 13 — No rate limit: 21st request to POST /api/auth/login must return 429
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 13 — No rate limit: POST /api/auth/login must return 429 after 20 requests', () => {
  /**
   * **Validates: Requirements 1.13**
   *
   * Send exactly 21 requests using the ACTUAL (unfixed) auth routes.
   * Assert the 21st returns 429.
   * On unfixed code: no rate limiting is applied → all 21 responses are 200 or 401
   * → the assertion FAILS, confirming the bug.
   *
   * Note: Uses the actual unfixed auth.routes.js (no rate limiting mock).
   * The test itself asserts the expected FIXED behavior (429 on 21st request).
   */

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('21st request to POST /api/auth/login returns 429', async () => {
    jest.doMock('../../config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../config/stripe', () => ({
      webhooks: { constructEvent: jest.fn() },
    }));
    jest.doMock('../../services/billing.service', () => ({
      createSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
    }));

    // Mock auth service to return 401 quickly (avoids DB calls)
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

    // Use the ACTUAL unfixed auth routes — no rate limiting applied
    // On unfixed code: all 21 responses will be 401 (not 429)
    const app = require('../../app');
    const request = require('supertest');
    const loginPayload = { email: 'test@example.com', password: 'password123' };

    let lastResponse;
    for (let i = 0; i < 21; i++) {
      lastResponse = await request(app)
        .post('/api/auth/login')
        .send(loginPayload);
    }

    // On unfixed code: all responses are 401 (no rate limiting) → this assertion FAILS
    expect(lastResponse.status).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 14 — UUID validator rejects integers: POST /api/appointments with integer
//           contactId must return 201 (not 422)
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 14 — UUID validator rejects integers: POST /api/appointments with integer contactId must succeed', () => {
  /**
   * **Validates: Requirements 1.14**
   *
   * On unfixed code: body('contactId').isUUID() rejects integer contactId → 422.
   * Expected: returns 201 (or 200).
   */

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('POST /api/appointments with integer contactId returns 201 (not 422)', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'appt-uuid-1',
        tenant_id: 'tenant-1',
        contact_id: 42,
        title: 'Test',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        reminder_channel: 'sms',
      },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const insertMock = jest.fn().mockReturnValue({ select: selectMock });

    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ insert: insertMock }),
    }));

    jest.doMock('../../services/reminder.service', () => ({
      scheduleReminders: jest.fn().mockResolvedValue(undefined),
      skipPendingReminders: jest.fn().mockResolvedValue(undefined),
    }));

    jest.doMock('../../jobs/reminder.queue', () => ({
      add: jest.fn().mockResolvedValue({}),
    }));

    const app = buildMockApp();
    const request = require('supertest');

    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer fake-token')
      .send({
        contactId: 42,
        title: 'Test',
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        reminderChannel: 'sms',
      });

    // On unfixed code: isUUID() rejects integer → returns 422 → this assertion FAILS
    expect(response.status).not.toBe(422);
    expect(response.status).toBeLessThanOrEqual(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 15 — No webhook handler: POST /api/billing/webhook must return 200
// ─────────────────────────────────────────────────────────────────────────────
describe('Bug 15 — No webhook handler: POST /api/billing/webhook must return 200', () => {
  /**
   * **Validates: Requirements 1.15**
   *
   * On unfixed code: no POST /api/billing/webhook route exists → returns 404.
   * Expected: returns 200.
   */

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('POST /api/billing/webhook returns 200 (not 404)', async () => {
    // Mock supabase with a full chain for the webhook handler's DB update
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    jest.doMock('../../config/supabase', () => ({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    }));
    jest.doMock('../../config/stripe', () => ({
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_123', customer: 'cus_123' } },
        }),
      },
    }));
    jest.doMock('../../services/billing.service', () => ({
      createSubscription: jest.fn().mockResolvedValue({}),
      cancelSubscription: jest.fn().mockResolvedValue({}),
      handleWebhookEvent: jest.fn().mockResolvedValue({}),
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

    // Mock Stripe customer.subscription.deleted payload
    const mockStripePayload = JSON.stringify({
      id: 'evt_test_123',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
        },
      },
    });

    const response = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-signature')
      .send(mockStripePayload);

    // On unfixed code: no handler exists → returns 404 → this assertion FAILS
    expect(response.status).toBe(200);
  });
});
