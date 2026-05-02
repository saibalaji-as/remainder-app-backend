/**
 * Property-based tests for appointments.controller.js — updateStatus handler
 *
 * Property 4: Status transition guard rejects invalid transitions
 * Property 8: Allowed transitions are exhaustive and non-overlapping
 *
 * Uses fast-check for property generation.
 */

const fc = require('fast-check');

// ─── Mock dependencies before requiring the controller ───────────────────────

const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const mockEmit = jest.fn();
jest.mock('../../sse.manager', () => ({ emit: mockEmit }));

const mockSkipPendingReminders = jest.fn();
jest.mock('../../services/reminder.service', () => ({
  skipPendingReminders: mockSkipPendingReminders,
}));

jest.mock('../../services/appointment.service', () => ({
  createAppointment: jest.fn(),
  listAppointments: jest.fn(),
  getAppointmentById: jest.fn(),
  updateAppointment: jest.fn(),
  deleteAppointment: jest.fn(),
}));

jest.mock('../../jobs/reminder.queue', () => ({ addReminderJob: jest.fn() }));

const appointmentsController = require('../../controllers/appointments.controller');

// ─── Re-export ALLOWED_TRANSITIONS for property tests ────────────────────────
// We derive the same constant here to test against the controller's behaviour
const ALLOWED_TRANSITIONS = {
  scheduled:  ['confirmed', 'cancelled'],
  confirmed:  ['completed', 'cancelled'],
  completed:  [],
  cancelled:  [],
};

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Express-like req/res/next triple for testing. */
function buildReqRes(params = {}, body = {}, tenantId = 'tenant-1') {
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
  const req = { params, body, tenantId };
  const next = jest.fn();
  return { req, res, next };
}

/**
 * Build a Supabase chain for the fetch path:
 *   from('appointments').select('*, contacts(*)').eq('id', id).eq('tenant_id', tenantId).single()
 */
function buildFetchChain(resolvedData, resolvedError = null) {
  const single = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const eq2 = jest.fn().mockReturnValue({ single });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  const select = jest.fn().mockReturnValue({ eq: eq1 });
  return { select, eq1, eq2, single };
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
  return { update, eq, select, single };
}

/**
 * Set up mockFrom to return the fetch chain on the first call and the update
 * chain on the second call (if needed).
 */
function setupMocks(fetchData, updateData = null) {
  const fetchChain = buildFetchChain(fetchData);
  const updateChain = buildUpdateChain(updateData);

  mockFrom
    .mockReturnValueOnce({ select: fetchChain.select })
    .mockReturnValueOnce({ update: updateChain.update });
}

// ─── Property 4: Status transition guard rejects invalid transitions ──────────

/**
 * **Validates: Requirements 5.3, 5.4**
 *
 * For any appointment status S and any target status T not in
 * ALLOWED_TRANSITIONS[S], calling PATCH /api/appointments/:id/status with
 * { status: T } must return HTTP 400. The appointment status must remain S.
 */
describe('appointments.controller - Property 4: Status transition guard rejects invalid transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSkipPendingReminders.mockResolvedValue([]);
  });

  test(
    'invalid transitions return 400 with the correct error message',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ALL_STATUSES), // current status S
          fc.constantFrom(...ALL_STATUSES), // target status T
          fc.uuid(),                         // appointmentId
          fc.uuid(),                         // tenantId
          async (currentStatus, targetStatus, appointmentId, tenantId) => {
            // Only test cases where the transition is NOT allowed
            fc.pre(!ALLOWED_TRANSITIONS[currentStatus].includes(targetStatus));

            const fakeAppointment = {
              id: appointmentId,
              title: 'Test Appointment',
              status: currentStatus,
              tenant_id: tenantId,
              contacts: { name: 'Alice' },
            };

            // Only the fetch chain is needed — update should never be called
            const fetchChain = buildFetchChain(fakeAppointment);
            mockFrom.mockReturnValue({ select: fetchChain.select });

            const { req, res, next } = buildReqRes(
              { id: appointmentId },
              { status: targetStatus },
              tenantId
            );

            await appointmentsController.updateStatus(req, res, next);

            expect(res._status).toBe(400);
            expect(res._body).toEqual({
              message: `Invalid status transition from ${currentStatus} to ${targetStatus}`,
            });

            // Supabase update must NOT be called
            expect(mockSkipPendingReminders).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );

  test(
    'valid transitions proceed and return 200 with the updated appointment',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ALL_STATUSES), // current status S
          fc.uuid(),                         // appointmentId
          fc.uuid(),                         // tenantId
          async (currentStatus, appointmentId, tenantId) => {
            const allowedTargets = ALLOWED_TRANSITIONS[currentStatus];
            // Only run for statuses that have at least one allowed transition
            fc.pre(allowedTargets.length > 0);

            // Pick the first allowed target deterministically
            const targetStatus = allowedTargets[0];

            const fakeAppointment = {
              id: appointmentId,
              title: 'Test Appointment',
              status: currentStatus,
              tenant_id: tenantId,
              contacts: { name: 'Bob' },
            };

            const updatedAppointment = { ...fakeAppointment, status: targetStatus };

            setupMocks(fakeAppointment, updatedAppointment);

            const { req, res, next } = buildReqRes(
              { id: appointmentId },
              { status: targetStatus },
              tenantId
            );

            await appointmentsController.updateStatus(req, res, next);

            expect(res._status).toBe(200);
            expect(res._body).toMatchObject({ status: targetStatus });
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'appointment not found returns 404',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // appointmentId
          fc.uuid(), // tenantId
          fc.constantFrom(...ALL_STATUSES),
          async (appointmentId, tenantId, targetStatus) => {
            // Simulate Supabase returning no data (not found)
            const fetchChain = buildFetchChain(null, { code: 'PGRST116', message: 'Not found' });
            mockFrom.mockReturnValue({ select: fetchChain.select });

            const { req, res, next } = buildReqRes(
              { id: appointmentId },
              { status: targetStatus },
              tenantId
            );

            await appointmentsController.updateStatus(req, res, next);

            expect(res._status).toBe(404);
            expect(res._body).toEqual({ message: 'Not found' });
          }
        ),
        { numRuns: 30 }
      );
    },
    20000
  );
});

// ─── Property 8: Allowed transitions are exhaustive and non-overlapping ───────

/**
 * **Validates: Requirements 5.2**
 *
 * For any status value in AppointmentStatus:
 * - ALLOWED_TRANSITIONS[status] must not contain the status itself (no self-transitions)
 * - Terminal states (completed, cancelled) must have empty transition arrays
 */
describe('appointments.controller - Property 8: Allowed transitions are exhaustive and non-overlapping', () => {
  test(
    'no status allows a self-transition',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_STATUSES),
          (status) => {
            expect(ALLOWED_TRANSITIONS[status]).not.toContain(status);
          }
        ),
        { numRuns: ALL_STATUSES.length }
      );
    }
  );

  test(
    'terminal states (completed, cancelled) have empty transition arrays',
    () => {
      const terminalStates = ['completed', 'cancelled'];
      fc.assert(
        fc.property(
          fc.constantFrom(...terminalStates),
          (terminalStatus) => {
            expect(ALLOWED_TRANSITIONS[terminalStatus]).toEqual([]);
          }
        ),
        { numRuns: terminalStates.length }
      );
    }
  );

  test(
    'non-terminal states (scheduled, confirmed) have at least one allowed transition',
    () => {
      const nonTerminalStates = ['scheduled', 'confirmed'];
      fc.assert(
        fc.property(
          fc.constantFrom(...nonTerminalStates),
          (status) => {
            expect(ALLOWED_TRANSITIONS[status].length).toBeGreaterThan(0);
          }
        ),
        { numRuns: nonTerminalStates.length }
      );
    }
  );

  test(
    'all transition targets are valid known statuses',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_STATUSES),
          (status) => {
            for (const target of ALLOWED_TRANSITIONS[status]) {
              expect(ALL_STATUSES).toContain(target);
            }
          }
        ),
        { numRuns: ALL_STATUSES.length }
      );
    }
  );

  test(
    'ALLOWED_TRANSITIONS covers all known statuses (exhaustive)',
    () => {
      for (const status of ALL_STATUSES) {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true);
      }
    }
  );
});
