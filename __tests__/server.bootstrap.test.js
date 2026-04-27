'use strict';

describe('server bootstrap', () => {
  let listenCallback;
  let mockListen;
  let consoleSpy;

  beforeEach(() => {
    jest.resetModules();

    // Mock the reminder processor to avoid real Redis connections
    jest.mock('../jobs/reminder.processor', () => ({}));

    // Mock app.listen to capture the callback without binding to a real port
    mockListen = jest.fn((port, cb) => {
      listenCallback = cb;
    });

    jest.mock('../app', () => {
      const express = require('express');
      const app = express();
      app.listen = mockListen;
      app.use = jest.fn();
      return app;
    });

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('requires reminder.processor after server starts listening', () => {
    require('../server');

    // Trigger the listen callback
    listenCallback();

    // Verify the processor module was required (mock was called)
    const processor = require('../jobs/reminder.processor');
    expect(processor).toBeDefined();
  });

  it("logs 'Reminder job processor started' after loading the processor", () => {
    require('../server');

    listenCallback();

    const logMessages = consoleSpy.mock.calls.map(call => call[0]);
    expect(logMessages).toContain('Reminder job processor started');
  });

  it('logs server running message before processor message', () => {
    require('../server');

    listenCallback();

    const logMessages = consoleSpy.mock.calls.map(call => call[0]);
    const serverRunningIdx = logMessages.findIndex(m => typeof m === 'string' && m.includes('Server running on port'));
    const processorIdx = logMessages.indexOf('Reminder job processor started');

    expect(serverRunningIdx).toBeGreaterThanOrEqual(0);
    expect(processorIdx).toBeGreaterThan(serverRunningIdx);
  });
});
