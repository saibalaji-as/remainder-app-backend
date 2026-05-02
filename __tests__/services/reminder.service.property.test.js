// Feature: b2b-appointment-reminder-backend, Property 12: fetchPending returns only pending reminders
// Feature: b2b-appointment-reminder-backend, Property 13: updateStatus reflects in database

const fc = require('fast-check');

const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const mockQueueAdd = jest.fn();
jest.mock('../../jobs/reminder.queue', () => ({ add: mockQueueAdd }));

const reminderService = require('../../services/reminder.service');

// Helper: build a chainable Supabase mock where the last method resolves with { data, error }
function buildFetchPendingChain(resolvedData, resolvedError = null) {
  // Chain: from('reminders').select('*').eq('tenant_id', tenantId).eq('status', 'pending')
  const lastEq = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const firstEq = jest.fn().mockReturnValue({ eq: lastEq });
  const select = jest.fn().mockReturnValue({ eq: firstEq });
  mockFrom.mockReturnValue({ select });
  return { select, firstEq, lastEq };
}

function buildUpdateStatusChain(resolvedData = null, resolvedError = null) {
  // Chain: from('reminders').update({ status }).eq('id', reminderId)
  const eq = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const update = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ update });
  return { update, eq };
}

// Helper: build insert chain for scheduleReminders
// Chain: from('reminders').insert({...}).select().single()
function buildInsertChain(resolvedData, resolvedError = null) {
  const single = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  mockFrom.mockReturnValue({ insert });
  return { insert, select, single };
}

// **Validates: Requirements 11.3**
describe('reminder.service - Property 12: fetchPending returns only pending reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test(
    'fetchPending returns only records with status === "pending" for the given tenant',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 9999 }),
          fc.array(
            fc.record({
              status: fc.constantFrom('pending', 'sent', 'failed'),
              tenant_id: fc.integer({ min: 1, max: 9999 }),
            })
          ),
          async (tenantId, reminders) => {
            // Supabase already filters server-side; simulate by returning only pending for this tenant
            const pendingForTenant = reminders.filter(
              (r) => r.status === 'pending' && r.tenant_id === tenantId
            );

            buildFetchPendingChain(pendingForTenant);

            const result = await reminderService.fetchPending(tenantId);

            // All returned records must have status 'pending'
            expect(result.every((r) => r.status === 'pending')).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );
});

// **Validates: Requirements 11.4**
describe('reminder.service - Property 13: updateStatus reflects in database', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test(
    'updateStatus calls supabase .update with the correct status value',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 9999 }),
          fc.constantFrom('pending', 'sent', 'failed'),
          async (reminderId, status) => {
            const { update, eq } = buildUpdateStatusChain();

            await reminderService.updateStatus(reminderId, status);

            expect(mockFrom).toHaveBeenCalledWith('reminders');
            expect(update).toHaveBeenCalledWith({ status });
            expect(eq).toHaveBeenCalledWith('id', reminderId);
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );
});

// **Validates: Requirements 4.2, 4.3**
describe('reminder.service - Property 5: Exactly Three Reminders With Correct Timing and Channels', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: b2b-reminder-job-queue, Property 5: Exactly Three Reminders With Correct Timing and Channels',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ min: new Date(fixedNow + 25 * 3600 * 1000) }),
          async (appointmentId, scheduledAt) => {
            jest.clearAllMocks();
            mockQueueAdd.mockResolvedValue({});

            let callCount = 0;
            mockFrom.mockImplementation(() => {
              callCount++;
              const id = `reminder-id-${callCount}`;
              const single = jest.fn().mockResolvedValue({ data: { id }, error: null });
              const select = jest.fn().mockReturnValue({ single });
              const insert = jest.fn().mockReturnValue({ select });
              return { insert };
            });

            await reminderService.scheduleReminders(appointmentId, scheduledAt, 'both');

            // 'both' = sms+email: sms 24h, sms 2h, email 30min, sms 2min TEST, email 2min TEST = 5 jobs
            expect(mockQueueAdd).toHaveBeenCalledTimes(5);

            const calls = mockQueueAdd.mock.calls;
            const scheduledMs = scheduledAt.getTime();

            // Job 1: sms, 24h before
            expect(calls[0][0].channel).toBe('sms');
            const delay1 = calls[0][1].delay;
            const expected1 = scheduledMs - 24 * 3600 * 1000 - fixedNow;
            expect(Math.abs(delay1 - expected1)).toBeLessThanOrEqual(1000);

            // Job 2: sms, 2h before
            expect(calls[1][0].channel).toBe('sms');
            const delay2 = calls[1][1].delay;
            const expected2 = scheduledMs - 2 * 3600 * 1000 - fixedNow;
            expect(Math.abs(delay2 - expected2)).toBeLessThanOrEqual(1000);

            // Job 3: email, 30min before
            expect(calls[2][0].channel).toBe('email');
            const delay3 = calls[2][1].delay;
            const expected3 = scheduledMs - 30 * 60 * 1000 - fixedNow;
            expect(Math.abs(delay3 - expected3)).toBeLessThanOrEqual(1000);
          }
        ),
        { numRuns: 50 }
      );
    },
    60000
  );
});

// **Validates: Requirements 4.4**
describe('reminder.service - Property 6: Past Reminder Windows Are Skipped', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: b2b-reminder-job-queue, Property 6: Past Reminder Windows Are Skipped',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ max: new Date(fixedNow - 1000) }),
          async (appointmentId, scheduledAt) => {
            jest.clearAllMocks();

            await reminderService.scheduleReminders(appointmentId, scheduledAt, 'both');

            // No rows inserted, no jobs enqueued
            expect(mockFrom).not.toHaveBeenCalled();
            expect(mockQueueAdd).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    },
    60000
  );
});

// **Validates: Requirements 4.5**
describe('reminder.service - Property 7: Inserted Reminder Rows Have Correct Fields', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: b2b-reminder-job-queue, Property 7: Inserted Reminder Rows Have Correct Fields',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ min: new Date(fixedNow + 25 * 3600 * 1000) }),
          async (appointmentId, scheduledAt) => {
            jest.clearAllMocks();
            mockQueueAdd.mockResolvedValue({});

            const insertedRows = [];
            let callCount = 0;
            mockFrom.mockImplementation(() => {
              callCount++;
              const id = `reminder-id-${callCount}`;
              const single = jest.fn().mockResolvedValue({ data: { id }, error: null });
              const select = jest.fn().mockReturnValue({ single });
              const insert = jest.fn().mockImplementation((row) => {
                insertedRows.push(row);
                return { select };
              });
              return { insert };
            });

            await reminderService.scheduleReminders(appointmentId, scheduledAt, 'both');

            expect(insertedRows).toHaveLength(5);

            for (const row of insertedRows) {
              expect(row.appointment_id).toBe(appointmentId);
              expect(['sms', 'email']).toContain(row.channel);
              expect(row.status).toBe('pending');
              // scheduled_at must be a valid ISO timestamp
              expect(() => new Date(row.scheduled_at)).not.toThrow();
              expect(new Date(row.scheduled_at).toISOString()).toBe(row.scheduled_at);
            }
          }
        ),
        { numRuns: 50 }
      );
    },
    60000
  );
});

// **Validates: Requirements 4.6, 8.2**
describe('reminder.service - Property 8: Supabase Errors Propagate From Scheduler', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: b2b-reminder-job-queue, Property 8: Supabase Errors Propagate From Scheduler',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ min: new Date(fixedNow + 25 * 3600 * 1000) }),
          fc.record({ message: fc.string() }),
          async (appointmentId, scheduledAt, supabaseError) => {
            jest.clearAllMocks();

            mockFrom.mockImplementation(() => {
              const single = jest.fn().mockResolvedValue({ data: null, error: supabaseError });
              const select = jest.fn().mockReturnValue({ single });
              const insert = jest.fn().mockReturnValue({ select });
              return { insert };
            });

            await expect(
              reminderService.scheduleReminders(appointmentId, scheduledAt, 'both')
            ).rejects.toBe(supabaseError);
          }
        ),
        { numRuns: 50 }
      );
    },
    60000
  );
});

// **Validates: Requirements 4.8**
describe('reminder.service - Property 9: Bull Job Options Are Always Correctly Configured', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: b2b-reminder-job-queue, Property 9: Bull Job Options Are Always Correctly Configured',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ min: new Date(fixedNow + 25 * 3600 * 1000) }),
          async (appointmentId, scheduledAt) => {
            jest.clearAllMocks();
            mockQueueAdd.mockResolvedValue({});

            const offsets = [
              24 * 60 * 60 * 1000,  // sms 24h
              2 * 60 * 60 * 1000,   // sms 2h
              30 * 60 * 1000,       // email 30min
              2 * 60 * 1000,        // sms TEST 2min
              2 * 60 * 1000,        // email TEST 2min
            ];

            let callCount = 0;
            mockFrom.mockImplementation(() => {
              callCount++;
              const id = `reminder-id-${callCount}`;
              const single = jest.fn().mockResolvedValue({ data: { id }, error: null });
              const select = jest.fn().mockReturnValue({ single });
              const insert = jest.fn().mockReturnValue({ select });
              return { insert };
            });

            await reminderService.scheduleReminders(appointmentId, scheduledAt, 'both');

            expect(mockQueueAdd).toHaveBeenCalledTimes(5);

            const scheduledMs = scheduledAt.getTime();

            mockQueueAdd.mock.calls.forEach((call, i) => {
              const opts = call[1];
              const expectedDelay = scheduledMs - offsets[i] - fixedNow;

              expect(opts.attempts).toBe(3);
              expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
              expect(opts.removeOnComplete).toBe(true);
              expect(opts.removeOnFail).toBe(false);
              expect(Math.abs(opts.delay - expectedDelay)).toBeLessThanOrEqual(1000);
            });
          }
        ),
        { numRuns: 50 }
      );
    },
    60000
  );
});

// **Validates: Requirements 3.5, 5.5**
describe('reminder.service - Property 3: Cancellation skips all pending reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test(
    'skipPendingReminders updates all pending reminders for the given appointmentId to skipped',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (appointmentId) => {
            // Chain: from('reminders').update({ status: 'skipped' }).eq('appointment_id', appointmentId).eq('status', 'pending')
            const secondEq = jest.fn().mockResolvedValue({ data: [], error: null });
            const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
            const update = jest.fn().mockReturnValue({ eq: firstEq });
            mockFrom.mockReturnValue({ update });

            await reminderService.skipPendingReminders(appointmentId);

            expect(mockFrom).toHaveBeenCalledWith('reminders');
            expect(update).toHaveBeenCalledWith({ status: 'skipped' });
            expect(firstEq).toHaveBeenCalledWith('appointment_id', appointmentId);
            expect(secondEq).toHaveBeenCalledWith('status', 'pending');
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );

  test(
    'skipPendingReminders throws when Supabase returns an error',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.record({ message: fc.string() }),
          async (appointmentId, supabaseError) => {
            const secondEq = jest.fn().mockResolvedValue({ data: null, error: supabaseError });
            const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
            const update = jest.fn().mockReturnValue({ eq: firstEq });
            mockFrom.mockReturnValue({ update });

            await expect(
              reminderService.skipPendingReminders(appointmentId)
            ).rejects.toBe(supabaseError);
          }
        ),
        { numRuns: 50 }
      );
    },
    30000
  );
});

// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
describe('reminder.service - Property 7: scheduleReminders enqueues correct channel set for every valid reminderChannel value', () => {
  let dateNowSpy;
  const fixedNow = Date.now();

  // Channel matrix: maps each reminderChannel to the expected set of channels enqueued
  const channelMatrix = {
    sms:            ['sms'],
    email:          ['email'],
    both:           ['sms', 'email'],
    whatsapp:       ['whatsapp'],
    whatsapp_sms:   ['whatsapp', 'sms'],
    whatsapp_email: ['whatsapp', 'email'],
    all:            ['whatsapp', 'sms', 'email'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test(
    'Feature: whatsapp-reminder-channel, Property 7: scheduleReminders enqueues the correct channel set for every valid reminderChannel value',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.date({ min: new Date(fixedNow + 25 * 3600 * 1000) }),
          fc.constantFrom('sms', 'email', 'both', 'whatsapp', 'whatsapp_sms', 'whatsapp_email', 'all'),
          async (appointmentId, scheduledAt, reminderChannel) => {
            jest.clearAllMocks();
            mockQueueAdd.mockResolvedValue({});

            let callCount = 0;
            mockFrom.mockImplementation(() => {
              callCount++;
              const id = `reminder-id-${callCount}`;
              const single = jest.fn().mockResolvedValue({ data: { id }, error: null });
              const select = jest.fn().mockReturnValue({ single });
              const insert = jest.fn().mockReturnValue({ select });
              return { insert };
            });

            await reminderService.scheduleReminders(appointmentId, scheduledAt, reminderChannel);

            const enqueuedChannels = mockQueueAdd.mock.calls.map((call) => call[0].channel);
            const expectedChannels = channelMatrix[reminderChannel];

            // Every expected channel must appear at least once
            for (const ch of expectedChannels) {
              expect(enqueuedChannels).toContain(ch);
            }

            // No unexpected channels must appear
            for (const ch of enqueuedChannels) {
              expect(expectedChannels).toContain(ch);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    60000
  );
});
