// Feature: b2b-appointment-reminder-backend, Property 7: Reminder channel dispatch
// Feature: b2b-appointment-reminder-backend, Property 8: Reminder status update on completion

const fc = require('fast-check');

// Mock Bull to avoid Redis connection
let registeredProcessor = null;
let failedHandler = null;

const mockQueueAdd = jest.fn().mockResolvedValue({});
const mockQueueProcess = jest.fn().mockImplementation((fn) => { registeredProcessor = fn; });
const mockQueueOn = jest.fn().mockImplementation((event, fn) => {
  if (event === 'failed') failedHandler = fn;
});

jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    process: mockQueueProcess,
    on: mockQueueOn,
  }));
});

jest.mock('../../config/redis', () => ({ host: 'localhost', port: 6379 }));

// Mock services with correct method names
const mockSendReminderSms = jest.fn().mockResolvedValue({});
const mockSendReminderEmail = jest.fn().mockResolvedValue({});
const mockUpdateStatus = jest.fn().mockResolvedValue({});

jest.mock('../../services/sms.service', () => ({ sendReminderSms: mockSendReminderSms }));
jest.mock('../../services/email.service', () => ({ sendReminderEmail: mockSendReminderEmail }));
jest.mock('../../services/reminder.service', () => ({ updateStatus: mockUpdateStatus }));

// Load processor to register handlers
require('../../jobs/reminder.processor');

function makeJobData(overrides = {}) {
  return {
    reminderId: 1,
    appointmentId: 1,
    tenantId: 1,
    channel: 'sms',
    contactPhone: '+15550001111',
    contactEmail: 'test@example.com',
    appointmentTitle: 'Test Appointment',
    scheduledAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Property 7: Reminder channel dispatch', () => {
  // Validates: Requirements 7.3, 7.4, 7.5

  beforeEach(() => {
    mockSendReminderSms.mockClear();
    mockSendReminderEmail.mockClear();
    mockUpdateStatus.mockClear();
  });

  it('dispatches correct service(s) based on channel', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('sms', 'email', 'both'),
        async (channel) => {
          mockSendReminderSms.mockClear();
          mockSendReminderEmail.mockClear();
          mockUpdateStatus.mockClear();

          const job = { data: makeJobData({ channel }) };
          await registeredProcessor(job);

          if (channel === 'sms') {
            expect(mockSendReminderSms).toHaveBeenCalledTimes(1);
            expect(mockSendReminderEmail).not.toHaveBeenCalled();
          } else if (channel === 'email') {
            expect(mockSendReminderEmail).toHaveBeenCalledTimes(1);
            expect(mockSendReminderSms).not.toHaveBeenCalled();
          } else if (channel === 'both') {
            expect(mockSendReminderSms).toHaveBeenCalledTimes(1);
            expect(mockSendReminderEmail).toHaveBeenCalledTimes(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 8: Reminder status update on completion', () => {
  // Validates: Requirements 7.6

  beforeEach(() => {
    mockSendReminderSms.mockClear();
    mockSendReminderEmail.mockClear();
    mockUpdateStatus.mockClear();
  });

  it('calls reminder.service.updateStatus with (reminderId, "sent") after successful dispatch', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          reminderId: fc.integer({ min: 1 }),
          channel: fc.constantFrom('sms', 'email', 'both'),
        }),
        async ({ reminderId, channel }) => {
          mockSendReminderSms.mockClear();
          mockSendReminderEmail.mockClear();
          mockUpdateStatus.mockClear();

          const job = { data: makeJobData({ reminderId, channel }) };
          await registeredProcessor(job);

          expect(mockUpdateStatus).toHaveBeenCalledWith(reminderId, 'sent');
        }
      ),
      { numRuns: 100 }
    );
  });
});
