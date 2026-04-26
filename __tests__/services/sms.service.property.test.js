// Feature: b2b-appointment-reminder-backend, Property 9: SMS and Email service parameter forwarding

const fc = require('fast-check');

process.env.TWILIO_PHONE_NUMBER = '+15550000000';

const mockMessagesCreate = jest.fn();

jest.mock('../../config/twilio', () => ({
  messages: {
    create: mockMessagesCreate,
  },
}));

jest.mock('../../config/supabase', () => ({
  from: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
}));

const smsService = require('../../services/sms.service');

describe('sms.service - Property 9: SMS service parameter forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });
  });

  test(
    'messages.create is called with from: TWILIO_PHONE_NUMBER, correct to and body',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            to: fc.string({ minLength: 1 }),
            message: fc.string({ minLength: 1 }),
          }),
          async ({ to, message }) => {
            mockMessagesCreate.mockClear();
            mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });

            await smsService.sendSms({ to, message });

            expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
            expect(mockMessagesCreate).toHaveBeenCalledWith({
              from: process.env.TWILIO_PHONE_NUMBER,
              to,
              body: message,
            });
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );
});

// Feature: b2b-appointment-reminder-backend, Property 15: buildMessage formats date in IST timezone
describe('sms.service - Property 15: buildMessage formats date in IST timezone', () => {
  test(
    'returned string contains IST-formatted date and contact name',
    () => {
      fc.assert(
        fc.property(
          fc.date(),
          fc.string({ minLength: 1 }),
          fc.option(fc.string({ minLength: 1 })),
          (date, contactName, notes) => {
            const scheduledAt = date.toISOString();
            const expectedDate = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

            const result = smsService.buildMessage(contactName, scheduledAt, notes);

            expect(result).toContain(expectedDate);
            expect(result).toContain(contactName);
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );
});
