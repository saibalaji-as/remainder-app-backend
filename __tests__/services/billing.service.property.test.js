// Feature: b2b-appointment-reminder-backend, Property 10: Billing subscription DB record consistency
// Feature: b2b-appointment-reminder-backend, Property 11: Subscription cancellation status update

const fc = require('fast-check');

jest.mock('../../config/stripe', () => ({
  customers: { create: jest.fn(), update: jest.fn() },
  paymentMethods: { attach: jest.fn() },
  subscriptions: { create: jest.fn(), cancel: jest.fn() },
}));

const mockSupabase = { from: jest.fn() };
jest.mock('../../config/supabase', () => mockSupabase);

const stripe = require('../../config/stripe');
const supabase = require('../../config/supabase');
const billingService = require('../../services/billing.service');

function buildChain() {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

describe('billing.service - Property 10: Billing subscription DB record consistency', () => {
  /**
   * Validates: Requirements 9.1, 9.2
   *
   * For any tenantId, customerId, subscriptionId, and status, the resulting
   * DB Subscription record must contain the correct tenant_id, stripe_customer_id,
   * stripe_subscription_id, and a non-null status.
   */
  test('resulting DB Subscription record contains correct tenant_id, stripe_customer_id, stripe_subscription_id, non-null status', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.record({
          customerId: fc.string({ minLength: 1 }),
          subscriptionId: fc.string({ minLength: 1 }),
          status: fc.string({ minLength: 1 }),
        }),
        async (tenantId, { customerId, subscriptionId, status }) => {
          jest.clearAllMocks();

          const tenantChain = buildChain();
          tenantChain.single.mockResolvedValue({
            data: { id: tenantId, name: 'Test Tenant', email: 'tenant@test.com', stripe_customer_id: null },
            error: null,
          });

          const upsertChain = buildChain();
          upsertChain.single.mockResolvedValue({
            data: { tenant_id: tenantId, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, status },
            error: null,
          });

          supabase.from
            .mockReturnValueOnce(tenantChain)
            .mockReturnValueOnce(upsertChain);

          stripe.customers.create.mockResolvedValue({ id: customerId });
          stripe.paymentMethods.attach.mockResolvedValue({});
          stripe.customers.update.mockResolvedValue({});
          stripe.subscriptions.create.mockResolvedValue({ id: subscriptionId, status });

          const result = await billingService.createSubscription({ tenantId, priceId: 'price_test', paymentMethodId: 'pm_test' });

          expect(result.tenant_id).toBe(tenantId);
          expect(result.stripe_customer_id).toBe(customerId);
          expect(result.stripe_subscription_id).toBe(subscriptionId);
          expect(result.status).not.toBeNull();
          expect(result.status).toBe(status);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});

describe('billing.service - Property 11: Subscription cancellation status update', () => {
  /**
   * Validates: Requirements 9.3, 9.4
   *
   * For any tenantId, after cancelSubscription the returned record must have
   * status === 'canceled'.
   */
  test('Subscription record status === "canceled" after cancelSubscription', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          jest.clearAllMocks();

          const stripeSubId = `sub_${tenantId}`;

          const findChain = buildChain();
          findChain.single.mockResolvedValue({
            data: { tenant_id: tenantId, stripe_subscription_id: stripeSubId, status: 'active' },
            error: null,
          });

          const updateChain = buildChain();
          updateChain.single.mockResolvedValue({
            data: { tenant_id: tenantId, stripe_subscription_id: stripeSubId, status: 'canceled' },
            error: null,
          });

          supabase.from
            .mockReturnValueOnce(findChain)
            .mockReturnValueOnce(updateChain);

          stripe.subscriptions.cancel.mockResolvedValue({ status: 'canceled' });

          const result = await billingService.cancelSubscription({ tenantId });

          expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(stripeSubId);
          expect(result.status).toBe('canceled');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
