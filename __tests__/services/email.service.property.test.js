// Feature: b2b-appointment-reminder-backend, Property 9: SMS and Email service parameter forwarding

const fc = require('fast-check');

process.env.EMAIL_USER = 'test@gmail.com';

const mockSendMail = jest.fn();
const mockTransporter = { sendMail: mockSendMail };

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => mockTransporter),
}));

const emailService = require('../../services/email.service');

describe('email.service - Property 9: Email service parameter forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
  });

  /**
   * Validates: Requirements 9.2
   */
  test(
    'sendReminderEmail calls sendMail with correct to, IST-formatted subject, and html containing contact name',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            to: fc.emailAddress(),
            contactName: fc.string({ minLength: 1 }),
            scheduledAt: fc.date().map(d => d.toISOString()),
            notes: fc.option(fc.string({ minLength: 1 })),
          }),
          async ({ to, contactName, scheduledAt, notes }) => {
            mockSendMail.mockClear();
            mockSendMail.mockResolvedValue({ messageId: 'test-id' });

            await emailService.sendReminderEmail({ to, contactName, scheduledAt, notes });

            const istDate = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

            expect(mockSendMail).toHaveBeenCalledTimes(1);

            const callArgs = mockSendMail.mock.calls[0][0];
            expect(callArgs.to).toBe(to);
            expect(callArgs.subject).toContain(istDate);
            expect(callArgs.html).toContain(contactName);
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );
});
