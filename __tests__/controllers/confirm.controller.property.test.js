/**
 * Property-based tests for confirm.controller.js
 *
 * Property 1: Token verification rejects tampered tokens
 * Property 2: Confirmation is idempotent
 *
 * Uses fast-check for property generation.
 */

const fc = require('fast-check');
const jwt = require('jsonwebtoken');

// ─── Mock dependencies before requiring the controller ───────────────────────

const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const mockEmit = jest.fn();
jest.mock('../../sse.manager', () => ({ emit: mockEmit }));

const mockSkipPendingReminders = jest.fn();
jest.mock('../../services/reminder.service', () => ({
  skipPendingReminders: mockSkipPendingReminders,
}));

const confirmController = require('../../controllers/confirm.controller');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-for-property-tests';

/** Build a minimal Express-like req/res/next triple for testing. */
function buildReqRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  const next = jest.fn();
  return { res, next };
}

/**
 * Build a Supabase chain for:
 *   from('appointments').select('*, contacts(*)').eq('id', id).single()
 */
function buildAppointmentChain(resolvedData, resolvedError = null) {
  const single = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select });
  return { select, eq, single };
}

/**
 * Build a Supabase chain for the update path:
 *   from('appointments').update({status}).eq('id', id).select().single()
 */
function buildUpdateChain(resolvedData, resolvedError = null) {
  const single = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const select = jest.fn().mockReturnValue({ single });
  const eq = jest.fn().mockReturnValue({ select });
  const update = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ update });
  return { update, eq, select, single };
}

// ─── Property 1: Token verification rejects tampered tokens ──────────────────

/**
 * **Validates: Requirements 3.8**
 *
 * For any JWT token where the payload has been modified after signing,
 * GET /api/confirm?token= must return HTTP 400.
 * A valid token signed with the correct secret must return 200.
 */
describe('confirm.controller - Property 1: Token verification rejects tampered tokens', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  test(
    'tampered tokens (wrong secret) are rejected with 400',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          fc.string({ minLength: 8, maxLength: 32 }), // wrong secret
          async (appointmentId, tenantId, wrongSecret) => {
            // Ensure the wrong secret is actually different from the test secret
            fc.pre(wrongSecret !== TEST_SECRET);

            // Sign with the WRONG secret — this token should be rejected
            const tamperedToken = jwt.sign(
              { appointmentId, tenantId },
              wrongSecret,
              { expiresIn: '7d' }
            );

            const req = { query: { token: tamperedToken } };
            const { res, next } = buildReqRes();

            await confirmController.getAppointmentByToken(req, res, next);

            expect(res._status).toBe(400);
            expect(res._body).toEqual({ message: 'Invalid confirmation link' });
            // Supabase must NOT be called for tampered tokens
            expect(mockFrom).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'expired tokens are rejected with 400 and the expired message',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          async (appointmentId, tenantId) => {
            // Sign with a negative expiry so the token is immediately expired
            const expiredToken = jwt.sign(
              { appointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: -1 } // already expired
            );

            const req = { query: { token: expiredToken } };
            const { res, next } = buildReqRes();

            await confirmController.getAppointmentByToken(req, res, next);

            expect(res._status).toBe(400);
            expect(res._body).toEqual({ message: 'Confirmation link has expired' });
            expect(mockFrom).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'valid tokens signed with the correct secret proceed to the Supabase lookup',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          async (appointmentId, tenantId) => {
            const validToken = jwt.sign(
              { appointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: '7d' }
            );

            const fakeAppointment = {
              id: appointmentId,
              title: 'Test Appointment',
              scheduled_at: new Date().toISOString(),
              notes: null,
              status: 'scheduled',
              contacts: { name: 'Alice' },
            };

            buildAppointmentChain(fakeAppointment);

            const req = { query: { token: validToken } };
            const { res, next } = buildReqRes();

            await confirmController.getAppointmentByToken(req, res, next);

            // Should reach Supabase and return 200
            expect(mockFrom).toHaveBeenCalledWith('appointments');
            expect(res._status).toBe(200);
            expect(res._body).toMatchObject({
              appointmentId,
              status: 'scheduled',
            });
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'missing token returns 400 with Token is required',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(undefined, null, ''),
          async (missingToken) => {
            const req = { query: { token: missingToken } };
            const { res, next } = buildReqRes();

            await confirmController.getAppointmentByToken(req, res, next);

            expect(res._status).toBe(400);
            expect(res._body).toEqual({ message: 'Token is required' });
            expect(mockFrom).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 20 }
      );
    },
    15000
  );
});

// ─── Property 2: Confirmation is idempotent ───────────────────────────────────

/**
 * **Validates: Requirements 3.9**
 *
 * For any appointment already in `confirmed` or `cancelled` state,
 * calling POST /api/confirm with a valid token must return HTTP 200 with
 * the current status and must not modify the appointment or reminders.
 */
describe('confirm.controller - Property 2: Confirmation is idempotent', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
    mockSkipPendingReminders.mockResolvedValue([]);
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  test(
    'already-confirmed appointments return 200 with status confirmed without updating',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          fc.constantFrom('yes', 'no'), // any response
          async (appointmentId, tenantId, response) => {
            const validToken = jwt.sign(
              { appointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: '7d' }
            );

            const confirmedAppointment = {
              id: appointmentId,
              title: 'Already Confirmed',
              scheduled_at: new Date().toISOString(),
              notes: null,
              status: 'confirmed',
              confirmation_token: validToken,
              contacts: { name: 'Bob' },
            };

            buildAppointmentChain(confirmedAppointment);

            const req = { body: { token: validToken, response } };
            const { res, next } = buildReqRes();

            await confirmController.respondToConfirmation(req, res, next);

            expect(res._status).toBe(200);
            expect(res._body).toEqual({ status: 'confirmed' });

            // Must NOT call update or skipPendingReminders
            expect(mockSkipPendingReminders).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'already-cancelled appointments return 200 with status cancelled without updating',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          fc.constantFrom('yes', 'no'), // any response
          async (appointmentId, tenantId, response) => {
            const validToken = jwt.sign(
              { appointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: '7d' }
            );

            const cancelledAppointment = {
              id: appointmentId,
              title: 'Already Cancelled',
              scheduled_at: new Date().toISOString(),
              notes: null,
              status: 'cancelled',
              confirmation_token: validToken,
              contacts: { name: 'Carol' },
            };

            buildAppointmentChain(cancelledAppointment);

            const req = { body: { token: validToken, response } };
            const { res, next } = buildReqRes();

            await confirmController.respondToConfirmation(req, res, next);

            expect(res._status).toBe(200);
            expect(res._body).toEqual({ status: 'cancelled' });

            // Must NOT call update or skipPendingReminders
            expect(mockSkipPendingReminders).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'stale token (mismatch with stored confirmation_token) returns 400',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          fc.uuid(), // differentAppointmentId — used to produce a distinct stored token
          fc.constantFrom('yes', 'no'),
          async (appointmentId, tenantId, differentAppointmentId, response) => {
            // Ensure the two IDs differ so the tokens are guaranteed to differ
            fc.pre(appointmentId !== differentAppointmentId);

            // Token sent in the request (for appointmentId)
            const requestToken = jwt.sign(
              { appointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: '7d' }
            );

            // Stored token was generated for a different appointmentId — guaranteed mismatch
            const storedToken = jwt.sign(
              { appointmentId: differentAppointmentId, tenantId },
              TEST_SECRET,
              { expiresIn: '7d' }
            );

            const scheduledAppointment = {
              id: appointmentId,
              title: 'Scheduled Appointment',
              scheduled_at: new Date().toISOString(),
              notes: null,
              status: 'scheduled',
              confirmation_token: storedToken, // different from requestToken
              contacts: { name: 'Dave' },
            };

            buildAppointmentChain(scheduledAppointment);

            const req = { body: { token: requestToken, response } };
            const { res, next } = buildReqRes();

            await confirmController.respondToConfirmation(req, res, next);

            expect(res._status).toBe(400);
            expect(res._body).toEqual({
              message: 'This confirmation link is no longer valid',
            });

            expect(mockSkipPendingReminders).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );
});
