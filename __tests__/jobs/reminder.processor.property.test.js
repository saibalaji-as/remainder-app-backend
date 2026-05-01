const fc = require('fast-check');

// Capture registered handlers
let registeredProcessor = null;
let failedHandler = null;

const mockQueueProcess = jest.fn().mockImplementation((fn) => { registeredProcessor = fn; });
const mockQueueOn = jest.fn().mockImplementation((event, fn) => {
  if (event === 'failed') failedHandler = fn;
});
const mockQueueAdd = jest.fn().mockResolvedValue({});

jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    process: mockQueueProcess,
    on: mockQueueOn,
  }));
});

jest.mock('../../config/redis', () => ({}));

// Supabase mock with controllable responses
let mockFetchResult = { data: null, error: null };
let mockUpdateResult = { error: null };

const mockSingle = jest.fn().mockImplementation(() => mockFetchResult);
const mockEqFetch = jest.fn().mockReturnValue({ single: mockSingle });
const mockSelectFn = jest.fn().mockReturnValue({ eq: mockEqFetch });

const mockEqUpdate = jest.fn().mockImplementation(() => mockUpdateResult);
const mockUpdateFn = jest.fn().mockReturnValue({ eq: mockEqUpdate });

const mockFrom = jest.fn().mockImplementation((table) => ({
  select: mockSelectFn,
  update: mockUpdateFn,
}));

jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const mockSendReminderSms = jest.fn().mockResolvedValue({});
const mockSendReminderEmail = jest.fn().mockResolvedValue({});

jest.mock('../../services/sms.service', () => ({ sendReminderSms: mockSendReminderSms }));
jest.mock('../../services/email.service', () => ({ sendReminderEmail: mockSendReminderEmail }));

// Load processor to register handlers
require('../../jobs/reminder.processor');

function makeAppointment(overrides = {}) {
  return {
    id: 'appt-1',
    status: 'scheduled',
    scheduled_at: new Date().toISOString(),
    title: 'Checkup',
    notes: 'Bring your insurance card',
    tenant_id: 'tenant-1',
    contacts: {
      id: 'contact-1',
      name: 'Alice',
      phone: '+15550001111',
      email: 'alice@example.com',
    },
    ...overrides,
  };
}

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    data: {
      reminderId: 'reminder-1',
      appointmentId: 'appt-1',
      channel: 'sms',
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchResult = { data: makeAppointment(), error: null };
  mockUpdateResult = { error: null };
  mockSingle.mockImplementation(() => mockFetchResult);
  mockEqFetch.mockReturnValue({ single: mockSingle });
  mockSelectFn.mockReturnValue({ eq: mockEqFetch });
  mockEqUpdate.mockImplementation(() => mockUpdateResult);
  mockUpdateFn.mockReturnValue({ eq: mockEqUpdate });
  mockFrom.mockImplementation(() => ({
    select: mockSelectFn,
    update: mockUpdateFn,
  }));
});

// **Validates: Requirements 3.4**
describe('Feature: b2b-reminder-job-queue, Property 1: Cancelled Appointments Are Always Skipped', () => {
  it('skips SMS/email and updates status to skipped for any cancelled appointment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          reminderId: fc.uuid(),
          appointmentId: fc.uuid(),
          channel: fc.oneof(fc.constant('sms'), fc.constant('email')),
        }),
        async ({ reminderId, appointmentId, channel }) => {
          jest.clearAllMocks();

          const cancelledAppointment = makeAppointment({ status: 'cancelled' });
          mockSingle.mockReturnValue({ data: cancelledAppointment, error: null });
          mockEqFetch.mockReturnValue({ single: mockSingle });
          mockSelectFn.mockReturnValue({ eq: mockEqFetch });
          mockEqUpdate.mockReturnValue({ error: null });
          mockUpdateFn.mockReturnValue({ eq: mockEqUpdate });
          mockFrom.mockImplementation(() => ({
            select: mockSelectFn,
            update: mockUpdateFn,
          }));

          const job = makeJob({ reminderId, appointmentId, channel });
          const result = await registeredProcessor(job);

          expect(result).toEqual({ skipped: true });
          expect(mockSendReminderSms).not.toHaveBeenCalled();
          expect(mockSendReminderEmail).not.toHaveBeenCalled();

          // Verify supabase update was called with 'skipped'
          expect(mockUpdateFn).toHaveBeenCalledWith({ status: 'skipped' });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 3.5, 3.6**
describe('Feature: b2b-reminder-job-queue, Property 2: Channel Routing Dispatches the Correct Service', () => {
  it('calls sendReminderSms for sms channel and sendReminderEmail for email channel', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant('sms'), fc.constant('email')),
        async (channel) => {
          jest.clearAllMocks();

          const appointment = makeAppointment({ status: 'scheduled' });
          mockSingle.mockReturnValue({ data: appointment, error: null });
          mockEqFetch.mockReturnValue({ single: mockSingle });
          mockSelectFn.mockReturnValue({ eq: mockEqFetch });
          mockEqUpdate.mockReturnValue({ error: null });
          mockUpdateFn.mockReturnValue({ eq: mockEqUpdate });
          mockFrom.mockImplementation(() => ({
            select: mockSelectFn,
            update: mockUpdateFn,
          }));

          const job = makeJob({ channel });
          await registeredProcessor(job);

          if (channel === 'sms') {
            expect(mockSendReminderSms).toHaveBeenCalledTimes(1);
            expect(mockSendReminderSms).toHaveBeenCalledWith(job.data.reminderId, appointment);
            expect(mockSendReminderEmail).not.toHaveBeenCalled();
          } else if (channel === 'email') {
            expect(mockSendReminderEmail).toHaveBeenCalledTimes(1);
            expect(mockSendReminderEmail).toHaveBeenCalledWith({
              to: appointment.contacts.email,
              contactName: appointment.contacts.name,
              scheduledAt: appointment.scheduled_at,
              notes: appointment.notes,
              tenantId: appointment.tenant_id,
              reminderId: job.data.reminderId,
              appointmentTitle: appointment.title,
            });
            expect(mockSendReminderSms).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 3.7**
describe('Feature: b2b-reminder-job-queue, Property 3: Successful Delivery Updates Reminder Status', () => {
  it('updates reminder with status sent and valid ISO 8601 sent_at after successful delivery', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          reminderId: fc.uuid(),
          channel: fc.oneof(fc.constant('sms'), fc.constant('email')),
        }),
        async ({ reminderId, channel }) => {
          jest.clearAllMocks();

          const appointment = makeAppointment({ status: 'scheduled' });
          mockSingle.mockReturnValue({ data: appointment, error: null });
          mockEqFetch.mockReturnValue({ single: mockSingle });
          mockSelectFn.mockReturnValue({ eq: mockEqFetch });
          mockEqUpdate.mockReturnValue({ error: null });
          mockUpdateFn.mockReturnValue({ eq: mockEqUpdate });
          mockFrom.mockImplementation(() => ({
            select: mockSelectFn,
            update: mockUpdateFn,
          }));

          const job = makeJob({ reminderId, channel });
          await registeredProcessor(job);

          // The last update call should be with status 'sent' and a sent_at
          const updateCalls = mockUpdateFn.mock.calls;
          const sentUpdateCall = updateCalls.find(
            (call) => call[0] && call[0].status === 'sent'
          );
          expect(sentUpdateCall).toBeDefined();

          const { status, sent_at } = sentUpdateCall[0];
          expect(status).toBe('sent');
          // Validate ISO 8601 format
          expect(new Date(sent_at).toISOString()).toBe(sent_at);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 3.8, 3.9**
describe('Feature: b2b-reminder-job-queue, Property 4: Job Completion Logging Contains Job ID', () => {
  it('success log contains checkmark and job ID', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (jobId) => {
          jest.clearAllMocks();
          consoleSpy.mockClear();

          const appointment = makeAppointment({ status: 'scheduled' });
          mockSingle.mockReturnValue({ data: appointment, error: null });
          mockEqFetch.mockReturnValue({ single: mockSingle });
          mockSelectFn.mockReturnValue({ eq: mockEqFetch });
          mockEqUpdate.mockReturnValue({ error: null });
          mockUpdateFn.mockReturnValue({ eq: mockEqUpdate });
          mockFrom.mockImplementation(() => ({
            select: mockSelectFn,
            update: mockUpdateFn,
          }));

          const job = makeJob({ jobId });
          job.id = jobId;
          await registeredProcessor(job);

          const logCalls = consoleSpy.mock.calls.map((c) => c[0]);
          const successLog = logCalls.find((msg) => msg && msg.includes('✅'));
          expect(successLog).toBeDefined();
          expect(successLog).toContain(jobId);
        }
      ),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('failure log contains X mark, job ID, and error message', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (jobId, errorMessage) => {
          consoleErrorSpy.mockClear();

          const job = makeJob();
          job.id = jobId;
          const err = new Error(errorMessage);

          failedHandler(job, err);

          const errorCalls = consoleErrorSpy.mock.calls.map((c) => c[0]);
          const failLog = errorCalls.find((msg) => msg && msg.includes('❌'));
          expect(failLog).toBeDefined();
          expect(failLog).toContain(jobId);
          expect(failLog).toContain(errorMessage);
        }
      ),
      { numRuns: 100 }
    );

    consoleErrorSpy.mockRestore();
  });
});

// **Validates: Requirements 3.3, 8.1**
describe('Feature: b2b-reminder-job-queue, Property 11: Processor Supabase Errors Are Always Thrown', () => {
  it('throws the exact error returned by supabase fetch', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ message: fc.string({ minLength: 1 }) }),
        async (supabaseError) => {
          jest.clearAllMocks();

          mockSingle.mockReturnValue({ data: null, error: supabaseError });
          mockEqFetch.mockReturnValue({ single: mockSingle });
          mockSelectFn.mockReturnValue({ eq: mockEqFetch });
          mockFrom.mockImplementation(() => ({
            select: mockSelectFn,
            update: mockUpdateFn,
          }));

          const job = makeJob();
          await expect(registeredProcessor(job)).rejects.toBe(supabaseError);
        }
      ),
      { numRuns: 100 }
    );
  });
});
