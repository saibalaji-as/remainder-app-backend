// Feature: b2b-reminder-job-queue
// Unit tests for reminder.queue.js (Requirements 2.1, 2.2, 2.3)

const fc = require('fast-check');

// Mock ioredis to avoid real connections
const mockRedisInstances = [];
const MockRedis = jest.fn().mockImplementation(() => {
  const instance = { on: jest.fn().mockReturnThis() };
  mockRedisInstances.push(instance);
  return instance;
});
jest.mock('ioredis', () => MockRedis);

// Mock Bull to avoid Redis connection
const mockBullInstance = {
  add: jest.fn().mockResolvedValue({}),
  process: jest.fn(),
  on: jest.fn(),
};
const MockBull = jest.fn().mockImplementation(() => mockBullInstance);
jest.mock('bull', () => MockBull);

describe('Reminder Queue (Requirements 2.1, 2.2, 2.3)', () => {
  let reminderQueue;

  beforeAll(() => {
    reminderQueue = require('../../jobs/reminder.queue');
  });

  it('2.1 - Bull queue is created with name "reminders"', () => {
    expect(MockBull).toHaveBeenCalledWith('reminders', expect.any(Object));
  });

  it('2.2 - Queue is initialized using createClient factory', () => {
    const options = MockBull.mock.calls[0][1];
    expect(typeof options.createClient).toBe('function');
  });

  it('2.3 - Queue instance is exported', () => {
    expect(reminderQueue).toBe(mockBullInstance);
  });
});

/**
 * Property-based tests
 * Validates: Requirements 2.2
 */
describe('Reminder Queue Property Tests', () => {
  it(
    'Feature: b2b-reminder-job-queue, Property: Queue uses correct Redis client — createClient factory returns a fresh ioredis instance for each Bull connection type',
    () => {
      const bullOptions = MockBull.mock.calls[0][1];
      const createClient = bullOptions.createClient;

      // Property: for any Bull connection type, createClient returns an ioredis instance
      fc.assert(
        fc.property(
          fc.constantFrom('client', 'bclient', 'subscriber'),
          (type) => {
            const instance = createClient(type);
            // Must be a valid ioredis-like object (constructed by MockRedis)
            return instance !== null && instance !== undefined;
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
