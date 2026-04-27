/**
 * Property-Based Tests for appointment.service.js
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

jest.mock('../../config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../services/reminder.service', () => ({ scheduleReminders: jest.fn() }));

const fc = require('fast-check');
const supabase = require('../../config/supabase');
const { scheduleReminders } = require('../../services/reminder.service');
const { createAppointment } = require('../../services/appointment.service');

function makeSupabaseChain(result) {
  const chain = {};
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('Feature: b2b-reminder-job-queue, Property 10: Appointment Creation Succeeds Regardless of Scheduler Outcome', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const appointmentArb = fc.record({
    id: fc.uuid(),
    scheduled_at: fc.date().map(d => d.toISOString()),
  });

  const inputArb = fc.record({
    tenantId: fc.uuid(),
    contactId: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    scheduledAt: fc.date().map(d => d.toISOString()),
    reminderChannel: fc.oneof(fc.constant('sms'), fc.constant('email')),
  });

  test('when scheduleReminders resolves: createAppointment returns the appointment', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, appointmentArb, async (input, appointment) => {
        const chain = makeSupabaseChain({ data: appointment, error: null });
        supabase.from.mockReturnValue(chain);
        scheduleReminders.mockResolvedValue(undefined);

        const result = await createAppointment(input);

        expect(result).toEqual(appointment);
      }),
      { numRuns: 100 }
    );
  });

  test('when scheduleReminders rejects: createAppointment still returns the appointment', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, appointmentArb, fc.string({ minLength: 1 }), async (input, appointment, errMsg) => {
        const chain = makeSupabaseChain({ data: appointment, error: null });
        supabase.from.mockReturnValue(chain);
        scheduleReminders.mockRejectedValue(new Error(errMsg));

        // Should not throw even though scheduleReminders rejects
        const result = await createAppointment(input);

        expect(result).toEqual(appointment);
      }),
      { numRuns: 100 }
    );
  });

  test('scheduleReminders is called with correct args (data.id, data.scheduled_at)', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, appointmentArb, async (input, appointment) => {
        const chain = makeSupabaseChain({ data: appointment, error: null });
        supabase.from.mockReturnValue(chain);
        scheduleReminders.mockResolvedValue(undefined);

        await createAppointment(input);

        expect(scheduleReminders).toHaveBeenCalledWith(appointment.id, appointment.scheduled_at);
      }),
      { numRuns: 100 }
    );
  });
});
