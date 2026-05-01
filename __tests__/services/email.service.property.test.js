// Feature: b2b-appointment-reminder-backend, Property 9: SMS and Email service parameter forwarding

const fc = require('fast-check');

process.env.EMAIL_USER = 'test@gmail.com';
process.env.EMAIL_APP_PASSWORD = 'test-app-password';

const mockSendMail = jest.fn();
const mockTransporter = { sendMail: mockSendMail };

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => mockTransporter),
}));

// Mock templateService to avoid Supabase env var requirement at module load
const mockGetByTenant = jest.fn();
const mockGetDefaults = jest.fn();
const mockRenderTemplate = jest.fn();
jest.mock('../../services/template.service', () => ({
  getByTenant: (...args) => mockGetByTenant(...args),
  getDefaults: (...args) => mockGetDefaults(...args),
  renderTemplate: (...args) => mockRenderTemplate(...args),
}));

// Mock sseManager — pure in-memory module, but mock to isolate side effects
const mockSseEmit = jest.fn();
jest.mock('../../sse.manager', () => ({
  emit: (...args) => mockSseEmit(...args),
  addClient: jest.fn(),
  removeClient: jest.fn(),
}));

const emailService = require('../../services/email.service');

describe('email.service - Property 9: Email service parameter forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });

    // Default template service behaviour: no tenant template, use defaults
    mockGetByTenant.mockResolvedValue(null);
    mockGetDefaults.mockReturnValue({
      subject:  'Appointment Reminder — {{appointmentDate}}',
      greeting: 'Hi {{contactName}},',
      body:     'This is a reminder for your upcoming appointment scheduled on {{appointmentDate}}.\n{{notes}}',
      closing:  'If you need to reschedule, please reply to this email.',
    });
    // renderTemplate: perform real substitution inline so the test stays meaningful
    mockRenderTemplate.mockImplementation((fields, context) => {
      const replace = (text) =>
        text
          .replace(/\{\{contactName\}\}/g,     () => context.contactName     ?? '')
          .replace(/\{\{appointmentDate\}\}/g, () => context.appointmentDate ?? '')
          .replace(/\{\{notes\}\}/g,           () => context.notes           ?? '');
      return {
        subject:  replace(fields.subject  ?? ''),
        greeting: replace(fields.greeting ?? ''),
        body:     replace(fields.body     ?? ''),
        closing:  replace(fields.closing  ?? ''),
      };
    });
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
