const mockSingle = jest.fn();
const mockSelect = jest.fn(() => ({ single: mockSingle }));
const mockEq = jest.fn(() => ({ single: mockSingle, select: () => ({ single: mockSingle }) }));
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
const mockUpsert = jest.fn(() => ({ select: () => ({ single: mockSingle }) }));
const mockFrom = jest.fn();

jest.mock('../../config/supabase', () => ({ from: mockFrom }));

jest.mock('../../config/stripe', () => ({
  customers: { create: jest.fn(), update: jest.fn() },
  paymentMethods: { attach: jest.fn() },
  subscriptions: { create: jest.fn(), cancel: jest.fn() },
}));

const stripe = require('../../config/stripe');
const supabase = require('../../config/supabase');
const billingService = require('../../services/billing.service');

function buildChain(overrides = {}) {
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
  Object.assign(chain, overrides);
  return chain;
}

describe('billing.service - createSubscription', () => {
  beforeEach(() => jest.clearAllMocks());

  test('subscribe success: DB record created with correct fields', async () => {
    const tenantId = 'tenant-1';
    const customerId = 'cus_abc';
    const subscriptionId = 'sub_abc';
    const status = 'active';

    const tenantChain = buildChain();
    tenantChain.single.mockResolvedValue({ data: { id: tenantId, name: 'Acme', email: 'acme@test.com', stripe_customer_id: null }, error: null });

    const upsertChain = buildChain();
    upsertChain.single.mockResolvedValue({ data: { tenant_id: tenantId, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, status }, error: null });

    supabase.from
      .mockReturnValueOnce(tenantChain)
      .mockReturnValueOnce(upsertChain);

    stripe.customers.create.mockResolvedValue({ id: customerId });
    stripe.paymentMethods.attach.mockResolvedValue({});
    stripe.customers.update.mockResolvedValue({});
    stripe.subscriptions.create.mockResolvedValue({ id: subscriptionId, status });

    const result = await billingService.createSubscription({ tenantId, priceId: 'price_abc', paymentMethodId: 'pm_abc' });

    expect(result.tenant_id).toBe(tenantId);
    expect(result.stripe_customer_id).toBe(customerId);
    expect(result.stripe_subscription_id).toBe(subscriptionId);
    expect(result.status).toBe(status);
  });

  test('uses existing stripe_customer_id if tenant already has one', async () => {
    const existingCustomerId = 'cus_existing';

    const tenantChain = buildChain();
    tenantChain.single.mockResolvedValue({ data: { id: 'tenant-2', name: 'Corp', email: 'corp@test.com', stripe_customer_id: existingCustomerId }, error: null });

    const upsertChain = buildChain();
    upsertChain.single.mockResolvedValue({ data: { tenant_id: 'tenant-2', stripe_customer_id: existingCustomerId, stripe_subscription_id: 'sub_xyz', status: 'active' }, error: null });

    supabase.from
      .mockReturnValueOnce(tenantChain)
      .mockReturnValueOnce(upsertChain);

    stripe.paymentMethods.attach.mockResolvedValue({});
    stripe.customers.update.mockResolvedValue({});
    stripe.subscriptions.create.mockResolvedValue({ id: 'sub_xyz', status: 'active' });

    await billingService.createSubscription({ tenantId: 'tenant-2', priceId: 'price_x', paymentMethodId: 'pm_x' });

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.paymentMethods.attach).toHaveBeenCalledWith('pm_x', { customer: existingCustomerId });
  });

  test('Stripe error during subscribe is re-thrown', async () => {
    const tenantChain = buildChain();
    tenantChain.single.mockResolvedValue({ data: { id: 'tenant-1', name: 'Acme', email: 'acme@test.com', stripe_customer_id: null }, error: null });

    supabase.from.mockReturnValueOnce(tenantChain);

    stripe.customers.create.mockRejectedValue(new Error('Stripe card declined'));

    await expect(billingService.createSubscription({ tenantId: 'tenant-1', priceId: 'price_x', paymentMethodId: 'pm_x' })).rejects.toThrow('Stripe card declined');
  });

  test('Supabase tenant lookup error is re-thrown', async () => {
    const tenantChain = buildChain();
    tenantChain.single.mockResolvedValue({ data: null, error: new Error('DB error') });

    supabase.from.mockReturnValueOnce(tenantChain);

    await expect(billingService.createSubscription({ tenantId: 'tenant-1', priceId: 'price_x', paymentMethodId: 'pm_x' })).rejects.toThrow('DB error');
  });
});

describe('billing.service - cancelSubscription', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cancel success: status becomes "canceled"', async () => {
    const tenantId = 'tenant-1';
    const stripeSubId = 'sub_abc';

    const findChain = buildChain();
    findChain.single.mockResolvedValue({ data: { tenant_id: tenantId, stripe_subscription_id: stripeSubId, status: 'active' }, error: null });

    const updateChain = buildChain();
    updateChain.single.mockResolvedValue({ data: { tenant_id: tenantId, stripe_subscription_id: stripeSubId, status: 'canceled' }, error: null });

    supabase.from
      .mockReturnValueOnce(findChain)
      .mockReturnValueOnce(updateChain);

    stripe.subscriptions.cancel.mockResolvedValue({ status: 'canceled' });

    const result = await billingService.cancelSubscription({ tenantId });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(stripeSubId);
    expect(result.status).toBe('canceled');
  });

  test('Stripe error during cancel is re-thrown', async () => {
    const findChain = buildChain();
    findChain.single.mockResolvedValue({ data: { tenant_id: 'tenant-1', stripe_subscription_id: 'sub_gone', status: 'active' }, error: null });

    supabase.from.mockReturnValueOnce(findChain);

    stripe.subscriptions.cancel.mockRejectedValue(new Error('Subscription not found'));

    await expect(billingService.cancelSubscription({ tenantId: 'tenant-1' })).rejects.toThrow('Subscription not found');
  });
});
