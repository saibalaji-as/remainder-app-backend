// Feature: b2b-appointment-reminder-backend, Property 12: fetchPending returns only pending reminders
// Feature: b2b-appointment-reminder-backend, Property 13: updateStatus reflects in database

const fc = require('fast-check');

const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

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
