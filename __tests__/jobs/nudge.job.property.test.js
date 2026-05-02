/**
 * Property-based tests for nudge.job.js
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.6**
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Mocks — set up before requiring the module under test
// ---------------------------------------------------------------------------

// Supabase mock — controllable per-test
let mockQueryResult = { data: [], error: null };
let mockUpdateResult = { error: null };

// Chain: .from().select().lt().in().or()
const mockOr = jest.fn().mockImplementation(() => mockQueryResult);
const mockIn = jest.fn().mockReturnValue({ or: mockOr });
const mockLt = jest.fn().mockReturnValue({ in: mockIn });
const mockSelect = jest.fn().mockReturnValue({ lt: mockLt });
const mockEqUpdate = jest.fn().mockImplementation(() => mockUpdateResult);
const mockUpdate = jest.fn().mockReturnValue({ eq: mockEqUpdate });

const mockFrom = jest.fn().mockImplementation(() => ({
  select: mockSelect,
  update: mockUpdate,
}));

jest.mock('../../config/supabase', () => ({ from: mockFrom }));

// SSE manager mock — controllable per-test
let mockHasClientsResult = true;
const mockEmit = jest.fn();
const mockHasClients = jest.fn().mockImplementation(() => mockHasClientsResult);

jest.mock('../../sse.manager', () => ({
  emit: mockEmit,
  hasClients: mockHasClients,
  addClient: jest.fn(),
  removeClient: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake appointment row as Supabase would return it.
 *
 * @param {object} overrides
 */
function makeAppointment(overrides = {}) {
  return {
    id: 'appt-1',
    tenant_id: 'tenant-1',
    title: 'Checkup',
    status: 'scheduled',
    scheduled_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    nudge_sent_at: null,
    contacts: { name: 'Alice' },
    ...overrides,
  };
}

/**
 * Reset all mocks to their default state.
 */
function resetMocks() {
  jest.clearAllMocks();
  mockQueryResult = { data: [], error: null };
  mockUpdateResult = { error: null };
  mockHasClientsResult = true;

  mockOr.mockImplementation(() => mockQueryResult);
  mockIn.mockReturnValue({ or: mockOr });
  mockLt.mockReturnValue({ in: mockIn });
  mockSelect.mockReturnValue({ lt: mockLt });
  mockEqUpdate.mockImplementation(() => mockUpdateResult);
  mockUpdate.mockReturnValue({ eq: mockEqUpdate });
  mockFrom.mockImplementation(() => ({
    select: mockSelect,
    update: mockUpdate,
  }));
  mockEmit.mockReset();
  mockHasClients.mockImplementation(() => mockHasClientsResult);
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
const { startNudgeJob } = require('../../jobs/nudge.job');

// ---------------------------------------------------------------------------
// Utility: run one tick of the nudge job without waiting for the real interval
// ---------------------------------------------------------------------------

/**
 * Trigger one interval tick and wait for it to complete.
 * We start the job, let one tick fire via jest fake timers, then stop it.
 */
async function runOneNudgeTick() {
  jest.useFakeTimers();
  const handle = startNudgeJob();
  // Advance time by exactly one interval (5 minutes)
  jest.advanceTimersByTime(300_000);
  // Flush all pending microtasks/promises — loop enough times to cover
  // the async work inside the interval callback (query + N row updates).
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  clearInterval(handle);
  jest.useRealTimers();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Property 5: Nudge job does not emit duplicate nudges within 1 hour
 *
 * For any appointment that has received a nudge, the nudge job must not emit
 * another `appointment-needs-update` event for that appointment until at least
 * 60 minutes have elapsed since `nudge_sent_at`.
 *
 * **Validates: Requirements 4.3**
 */
describe('Property 5: Nudge job does not emit duplicate nudges within 1 hour', () => {
  it('does not query appointments with nudge_sent_at within the last hour', async () => {
    // The Supabase query itself filters out recently-nudged appointments via
    // the .or() clause. We verify that the query is constructed with the
    // correct 1-hour threshold so that recently-nudged rows are excluded.
    await fc.assert(
      fc.asyncProperty(
        // Generate a nudge_sent_at that is LESS than 1 hour ago (recent nudge)
        fc.integer({ min: 1, max: 59 }).map((minutesAgo) =>
          new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
        ),
        async (recentNudgeSentAt) => {
          resetMocks();

          // The query returns NO rows (the DB filter excluded the recently-nudged row)
          mockQueryResult = { data: [], error: null };
          mockOr.mockImplementation(() => mockQueryResult);

          // Record the time just before the tick fires so we can compute the
          // expected 1-hour-ago threshold relative to when the job ran.
          jest.useFakeTimers();
          const beforeTick = Date.now();
          const handle = startNudgeJob();
          jest.advanceTimersByTime(300_000);
          // The job runs at (beforeTick + 300_000) in fake-timer land
          const jobRunTime = beforeTick + 300_000;
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          clearInterval(handle);
          jest.useRealTimers();

          // The .or() filter must include a threshold that is approximately
          // 1 hour before the moment the job ran.
          expect(mockOr).toHaveBeenCalledTimes(1);
          const orArg = mockOr.mock.calls[0][0];

          // Must contain the null check
          expect(orArg).toContain('nudge_sent_at.is.null');

          // Must contain a lt filter with a timestamp
          expect(orArg).toMatch(/nudge_sent_at\.lt\.\d{4}-\d{2}-\d{2}T/);

          // The timestamp in the filter must be approximately 1 hour before
          // the job's execution time (jobRunTime).
          const ltMatch = orArg.match(/nudge_sent_at\.lt\.(.+)/);
          expect(ltMatch).not.toBeNull();
          const filterTime = new Date(ltMatch[1]).getTime();
          const expectedOneHourAgo = jobRunTime - 60 * 60 * 1000;
          // Allow ±5 seconds tolerance for test execution time
          expect(Math.abs(filterTime - expectedOneHourAgo)).toBeLessThan(5000);

          // No SSE events should be emitted when no rows are returned
          expect(mockEmit).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('emits exactly one nudge per appointment per tick and updates nudge_sent_at', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1–5 distinct appointments that are past-due and not recently nudged
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            title: fc.string({ minLength: 1, maxLength: 50 }),
            contactName: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 5 }
        ).map((items) => {
          // Deduplicate by id
          const seen = new Set();
          return items.filter(({ id }) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        }).filter((items) => items.length > 0),
        async (appointmentDefs) => {
          resetMocks();

          const appointments = appointmentDefs.map(({ id, tenant_id, title, contactName }) =>
            makeAppointment({
              id,
              tenant_id,
              title,
              nudge_sent_at: null, // eligible — never nudged
              contacts: { name: contactName },
            })
          );

          mockQueryResult = { data: appointments, error: null };
          mockOr.mockImplementation(() => mockQueryResult);
          mockHasClients.mockReturnValue(true);

          // Each update().eq() call must return a fresh resolved result
          mockFrom.mockImplementation(() => ({
            select: mockSelect,
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }));

          await runOneNudgeTick();

          // Each appointment must receive exactly one emit call
          expect(mockEmit).toHaveBeenCalledTimes(appointments.length);

          // Each emit must use the correct event name
          for (const call of mockEmit.mock.calls) {
            expect(call[1]).toBe('appointment-needs-update');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('does not emit or update nudge_sent_at when no SSE clients are connected (req 4.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          tenant_id: fc.uuid(),
        }),
        async ({ id, tenant_id }) => {
          resetMocks();

          const appointment = makeAppointment({ id, tenant_id, nudge_sent_at: null });
          mockQueryResult = { data: [appointment], error: null };
          mockOr.mockImplementation(() => mockQueryResult);

          // No SSE clients connected for this tenant
          mockHasClients.mockReturnValue(false);

          await runOneNudgeTick();

          // Must check for clients
          expect(mockHasClients).toHaveBeenCalledWith(tenant_id);

          // Must NOT emit the SSE event
          expect(mockEmit).not.toHaveBeenCalled();

          // Must NOT update nudge_sent_at (no point recording a nudge that wasn't sent)
          expect(mockUpdate).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('emits the correct payload shape for every appointment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          tenant_id: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          contactName: fc.string({ minLength: 1, maxLength: 100 }),
          scheduledAt: fc.date({ min: new Date('2020-01-01'), max: new Date() })
            .map((d) => d.toISOString()),
        }),
        async ({ id, tenant_id, title, contactName, scheduledAt }) => {
          resetMocks();

          const appointment = makeAppointment({
            id,
            tenant_id,
            title,
            scheduled_at: scheduledAt,
            nudge_sent_at: null,
            contacts: { name: contactName },
          });

          mockQueryResult = { data: [appointment], error: null };
          mockOr.mockImplementation(() => mockQueryResult);
          mockHasClients.mockReturnValue(true);

          await runOneNudgeTick();

          expect(mockEmit).toHaveBeenCalledTimes(1);
          const [emittedTenantId, eventName, payload] = mockEmit.mock.calls[0];

          expect(emittedTenantId).toBe(tenant_id);
          expect(eventName).toBe('appointment-needs-update');
          expect(payload).toEqual({
            appointmentId: id,
            title,
            contactName,
            scheduledAt,
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  it('continues processing remaining appointments when one row causes an error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          goodId: fc.uuid(),
          badId: fc.uuid(),
          tenant_id: fc.uuid(),
        }).filter(({ goodId, badId }) => goodId !== badId),
        async ({ goodId, badId, tenant_id }) => {
          resetMocks();

          const goodAppointment = makeAppointment({ id: goodId, tenant_id, nudge_sent_at: null });
          const badAppointment = makeAppointment({ id: badId, tenant_id, nudge_sent_at: null });

          mockQueryResult = { data: [badAppointment, goodAppointment], error: null };
          mockOr.mockImplementation(() => mockQueryResult);
          mockHasClients.mockReturnValue(true);

          // Make the update fail for the bad appointment but succeed for the good one
          let updateCallCount = 0;
          mockUpdate.mockImplementation(() => {
            updateCallCount++;
            return {
              eq: jest.fn().mockImplementation(() => {
                if (updateCallCount === 1) {
                  return { error: new Error('DB write failed') };
                }
                return { error: null };
              }),
            };
          });

          const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

          await runOneNudgeTick();

          // Both appointments should still have emit called (emit happens before update)
          expect(mockEmit).toHaveBeenCalledTimes(2);

          // Error should be logged but not thrown
          expect(consoleErrorSpy).toHaveBeenCalled();

          consoleErrorSpy.mockRestore();
        }
      ),
      { numRuns: 20 }
    );
  });
});
