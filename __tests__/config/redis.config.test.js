'use strict';

/**
 * Unit tests for config/redis.js
 * Validates: Requirements 1.1, 1.2, 1.3
 */

// Must be defined before jest.mock() factory runs
const mockInstance = {
  on: jest.fn().mockReturnThis(),
};
const mockRedisConstructor = jest.fn(() => mockInstance);

jest.mock('ioredis', () => mockRedisConstructor);

// Load the module once after the mock is in place
const redis = require('../../config/redis');

describe('Redis configuration', () => {
  it('exports an ioredis instance', () => {
    expect(redis).toBe(mockInstance);
  });

  it('constructs Redis with process.env.REDIS_URL as the first argument', () => {
    expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
    expect(mockRedisConstructor.mock.calls[0][0]).toBe(process.env.REDIS_URL);
  });

  it('passes maxRetriesPerRequest: null in the options', () => {
    const options = mockRedisConstructor.mock.calls[0][1];
    expect(options).toHaveProperty('maxRetriesPerRequest', null);
  });

  it('passes tls: { rejectUnauthorized: false } in the options', () => {
    const options = mockRedisConstructor.mock.calls[0][1];
    expect(options).toHaveProperty('tls');
    expect(options.tls).toEqual({ rejectUnauthorized: false });
  });

  it('registers a "connect" event handler that logs success', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const connectCall = mockInstance.on.mock.calls.find(([event]) => event === 'connect');
    expect(connectCall).toBeDefined();

    connectCall[1]();
    expect(consoleSpy).toHaveBeenCalledWith('Redis connected (Upstash)');
  });

  it('registers an "error" event handler that logs the error message', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const errorCall = mockInstance.on.mock.calls.find(([event]) => event === 'error');
    expect(errorCall).toBeDefined();

    errorCall[1](new Error('connection refused'));
    expect(consoleSpy).toHaveBeenCalledWith('connection refused');
  });
});
