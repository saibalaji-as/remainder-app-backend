// Feature: b2b-appointment-reminder-backend, Property 6: Reminder job delay calculation

const fc = require('fast-check');

// Mock Bull to avoid Redis connection
const mockAdd = jest.fn().mockResolvedValue({});
jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    add: mockAdd,
    process: jest.fn(),
    on: jest.fn(),
  }));
});

// Mock redis config
jest.mock('../../config/redis', () => ({ host: 'localhost', port: 6379 }));

const { addReminderJob } = require('../../jobs/reminder.queue');

describe('Property 6: Reminder job delay calculation', () => {
  beforeEach(() => {
    mockAdd.mockClear();
  });

  it('Bull job delay matches scheduledAt - now - 24h within 500ms tolerance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date(Date.now() + 25 * 3600 * 1000) }),
        async (scheduledAt) => {
          mockAdd.mockClear();
          const before = Date.now();
          const expectedDelay = scheduledAt.getTime() - before - 24 * 60 * 60 * 1000;

          await addReminderJob({ scheduledAt: scheduledAt.toISOString() }, expectedDelay);

          expect(mockAdd).toHaveBeenCalledTimes(1);
          const [, options] = mockAdd.mock.calls[0];
          expect(options.delay).toBeDefined();
          expect(Math.abs(options.delay - expectedDelay)).toBeLessThanOrEqual(500);
        }
      ),
      { numRuns: 100 }
    );
  });
});
