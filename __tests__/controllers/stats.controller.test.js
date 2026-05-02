// Unit and integration-style tests for statsController
// Validates: Requirements 2.1, 3.5, 4.1, 5.1, 9.1, 9.2, 9.3, 9.4

'use strict';

// ---------------------------------------------------------------------------
// Supabase mock — fluent builder that is also a thenable
// ---------------------------------------------------------------------------

// We need to control what each call to supabase.from() resolves to.
// Strategy: keep a queue of results; each call to from() pops the next one.
// Default result is { count: 5, data: [], error: null }.

let supabaseResultQueue = [];

function makeBuilder(result) {
  const b = {
    then: (resolve, reject) => {
      if (result && result.error) {
        // If the result has an error field, still resolve (Supabase pattern)
        return Promise.resolve(result).then(resolve, reject);
      }
      return Promise.resolve(result).then(resolve, reject);
    },
    catch: (fn) => Promise.resolve(result).catch(fn),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => makeBuilder(result)),
  };
  return b;
}

const mockFrom = jest.fn();

jest.mock('../../config/supabase', () => ({
  from: (...args) => mockFrom(...args),
}));

// Also mock auth.service so authMiddleware can be required without env issues
jest.mock('../../services/auth.service', () => ({
  verifyToken: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Requires (after mocks are set up)
// ---------------------------------------------------------------------------

process.env.NODE_ENV = 'test';

const statsController = require('../../controllers/statsController');
const authMiddleware = require('../../middleware/auth.middleware');
const authService = require('../../services/auth.service');

const {
  getWeekBoundaries,
  get7DayWindow,
  getCurrentMonthBoundaries,
} = statsController.__testExports;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/**
 * Configure mockFrom so every call returns a builder resolving to `result`.
 */
function setAllSupabaseResults(result) {
  mockFrom.mockImplementation(() => makeBuilder(result));
}

/**
 * Configure mockFrom to throw (simulate a Supabase error).
 * We simulate this by returning a builder that resolves with { error: errObj }.
 */
function setSupabaseError(errObj) {
  mockFrom.mockImplementation(() => makeBuilder({ error: errObj }));
}

// ---------------------------------------------------------------------------
// Task 11.1 — Unit tests for date utility helpers
// ---------------------------------------------------------------------------

describe('getWeekBoundaries()', () => {
  let boundaries;

  beforeAll(() => {
    boundaries = getWeekBoundaries();
  });

  test('currentWeekStart is a Monday (getUTCDay() === 1)', () => {
    expect(boundaries.currentWeekStart.getUTCDay()).toBe(1);
  });

  test('currentWeekEnd is a Sunday (getUTCDay() === 0)', () => {
    expect(boundaries.currentWeekEnd.getUTCDay()).toBe(0);
  });

  test('currentWeekStart is at 00:00:00.000 UTC', () => {
    const d = boundaries.currentWeekStart;
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  test('currentWeekEnd is at 23:59:59.999 UTC', () => {
    const d = boundaries.currentWeekEnd;
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });

  test('prevWeekStart is exactly 7 days before currentWeekStart', () => {
    const diff = boundaries.currentWeekStart.getTime() - boundaries.prevWeekStart.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('prevWeekEnd is exactly 1ms before currentWeekStart', () => {
    const diff = boundaries.currentWeekStart.getTime() - boundaries.prevWeekEnd.getTime();
    expect(diff).toBe(1);
  });
});

describe('get7DayWindow()', () => {
  let window;

  beforeAll(() => {
    window = get7DayWindow();
  });

  test('windowStart is 6 days before windowEnd (same calendar day offset)', () => {
    const startDate = window.windowStart.toISOString().slice(0, 10);
    const endDate = window.windowEnd.toISOString().slice(0, 10);
    const startMs = new Date(startDate + 'T00:00:00.000Z').getTime();
    const endMs = new Date(endDate + 'T00:00:00.000Z').getTime();
    expect(endMs - startMs).toBe(6 * 24 * 60 * 60 * 1000);
  });

  test('windowStart is at 00:00:00.000 UTC', () => {
    const d = window.windowStart;
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  test('windowEnd is at 23:59:59.999 UTC', () => {
    const d = window.windowEnd;
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });

  test('the window spans exactly 7 days (from start 00:00 to end 23:59:59.999)', () => {
    const spanMs = window.windowEnd.getTime() - window.windowStart.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000 - 1; // 7 days minus 1ms
    expect(spanMs).toBe(sevenDaysMs);
  });
});

describe('getCurrentMonthBoundaries()', () => {
  let boundaries;
  let now;

  beforeAll(() => {
    now = new Date();
    boundaries = getCurrentMonthBoundaries();
  });

  test('monthStart is the 1st day of the current month at 00:00:00.000 UTC', () => {
    const d = boundaries.monthStart;
    expect(d.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(d.getUTCMonth()).toBe(now.getUTCMonth());
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  test('monthEnd is the last day of the current month at 23:59:59.999 UTC', () => {
    const d = boundaries.monthEnd;
    // Last day of month: day 0 of next month
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    expect(d.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(d.getUTCMonth()).toBe(now.getUTCMonth());
    expect(d.getUTCDate()).toBe(lastDay);
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Task 11.3 — Integration-style controller tests (Supabase mocked)
// ---------------------------------------------------------------------------

describe('getDashboardStats — integration-style tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Unauthenticated request → 401
  // -------------------------------------------------------------------------
  describe('unauthenticated request → 401', () => {
    test('authMiddleware returns 401 when Authorization header is absent', () => {
      const req = { headers: {} };
      const res = mockRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('authMiddleware returns 401 when token is invalid', () => {
      authService.verifyToken.mockImplementation(() => {
        throw new Error('invalid token');
      });

      const req = { headers: { authorization: 'Bearer bad-token' } };
      const res = mockRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Supabase query throws → 500
  // -------------------------------------------------------------------------
  test('Supabase query throws → responds with 500 and { error: message }', async () => {
    const dbError = new Error('DB error');
    setSupabaseError(dbError);

    const req = { tenantId: 'tenant-123' };
    const res = mockRes();

    await statsController.getDashboardStats(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'DB error' });
  });

  // -------------------------------------------------------------------------
  // Test 3: All queries succeed → 200 with all five top-level fields
  // -------------------------------------------------------------------------
  test('all queries succeed → 200 with stats, graphData, pieData, upcomingAppointments, recentReminders', async () => {
    // Return a result that satisfies both count queries ({ count: 5 })
    // and data queries ({ data: [] }) — use a combined object
    setAllSupabaseResults({ count: 5, data: [], error: null });

    const req = { tenantId: 'tenant-123' };
    const res = mockRes();

    await statsController.getDashboardStats(req, res);

    expect(res.status).not.toHaveBeenCalled(); // 200 is the default (res.json without status)
    expect(res.json).toHaveBeenCalledTimes(1);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toHaveProperty('stats');
    expect(payload).toHaveProperty('graphData');
    expect(payload).toHaveProperty('pieData');
    expect(payload).toHaveProperty('upcomingAppointments');
    expect(payload).toHaveProperty('recentReminders');
  });

  // -------------------------------------------------------------------------
  // Test 4: Empty tenant (no data) → 200 with zero counts and empty arrays
  // -------------------------------------------------------------------------
  test('empty tenant → 200 with zero counts and empty arrays', async () => {
    setAllSupabaseResults({ count: 0, data: [], error: null });

    const req = { tenantId: 'tenant-empty' };
    const res = mockRes();

    await statsController.getDashboardStats(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);

    const payload = res.json.mock.calls[0][0];

    // stats counts should all be zero
    expect(payload.stats.totalContacts).toBe(0);
    expect(payload.stats.totalAppointments).toBe(0);
    expect(payload.stats.totalRemindersSent).toBe(0);
    expect(payload.stats.totalRemindersFailed).toBe(0);
    expect(payload.stats.deliveryRate).toBe(0);

    // arrays should be empty
    expect(payload.upcomingAppointments).toEqual([]);
    expect(payload.recentReminders).toEqual([]);

    // graphData should have 7 entries with zero counts
    expect(payload.graphData).toHaveLength(7);
    for (const entry of payload.graphData) {
      expect(entry.appts).toBe(0);
      expect(entry.reminders).toBe(0);
    }

    // pieData should be zero
    expect(payload.pieData).toEqual({ sms: 0, email: 0, whatsapp: 0 });
  });
});

// ---------------------------------------------------------------------------
// Property 8: buildPieData counts each channel independently and correctly
// Validates: Requirements 6.4
// ---------------------------------------------------------------------------

const fc = require('fast-check');

describe('Property 8: buildPieData counts each channel independently and correctly', () => {
  test('for any array of rows with arbitrary channel values, counts match exactly with no cross-contamination', () => {
    const { buildPieData } = statsController.__testExports;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({ channel: fc.constantFrom('sms', 'email', 'whatsapp', 'other') })
        ),
        (rows) => {
          const result = buildPieData(rows);

          const expectedSms      = rows.filter(r => r.channel === 'sms').length;
          const expectedEmail    = rows.filter(r => r.channel === 'email').length;
          const expectedWhatsApp = rows.filter(r => r.channel === 'whatsapp').length;

          expect(result.sms).toBe(expectedSms);
          expect(result.email).toBe(expectedEmail);
          expect(result.whatsapp).toBe(expectedWhatsApp);

          // No cross-contamination: total counted must not exceed total rows
          expect(result.sms + result.email + result.whatsapp).toBeLessThanOrEqual(rows.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
