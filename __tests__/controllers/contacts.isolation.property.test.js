// Feature: b2b-appointment-reminder-backend, Property 3: Multi-tenant data isolation

const fc = require('fast-check');

// In-memory store shared across the mock chain
let _store = [];

// Chainable Supabase mock that tracks tenant_id filter from .eq() calls
const mockChain = {
  _tenantFilter: null,
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  eq: jest.fn().mockImplementation(function (col, val) {
    if (col === 'tenant_id') {
      mockChain._tenantFilter = val;
    }
    return mockChain;
  }),
  then: jest.fn().mockImplementation(function (resolve) {
    const filtered = _store.filter((c) => c.tenant_id === mockChain._tenantFilter);
    return Promise.resolve({ data: filtered, error: null }).then(resolve);
  }),
};

jest.mock('../../config/supabase', () => mockChain);

const contactsController = require('../../controllers/contacts.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function mockNext() {
  return jest.fn();
}

/**
 * Property 3: Multi-tenant data isolation
 * Validates: Requirements 2.4, 5.2
 *
 * For any two distinct tenants A and B, the list endpoint for tenant A
 * must never return contacts belonging to tenant B.
 */
describe('contacts.controller - Property 3: Multi-tenant data isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _store = [];
    mockChain._tenantFilter = null;

    // Re-wire mocks after clearAllMocks
    mockChain.from.mockReturnThis();
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.eq.mockImplementation(function (col, val) {
      if (col === 'tenant_id') {
        mockChain._tenantFilter = val;
      }
      return mockChain;
    });
    mockChain.then.mockImplementation(function (resolve) {
      const filtered = _store.filter((c) => c.tenant_id === mockChain._tenantFilter);
      return Promise.resolve({ data: filtered, error: null }).then(resolve);
    });
  });

  test(
    'list for tenant A never contains contacts belonging to tenant B',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .tuple(fc.integer({ min: 1 }), fc.integer({ min: 1 }))
            .filter(([a, b]) => a !== b),
          fc.array(
            fc.record({
              id: fc.integer({ min: 1 }),
              name: fc.string({ minLength: 1 }),
              email: fc.emailAddress(),
              phone: fc.string({ minLength: 1 }),
            }),
            { minLength: 0, maxLength: 5 }
          ),
          fc.array(
            fc.record({
              id: fc.integer({ min: 1 }),
              name: fc.string({ minLength: 1 }),
              email: fc.emailAddress(),
              phone: fc.string({ minLength: 1 }),
            }),
            { minLength: 0, maxLength: 5 }
          ),
          async ([tenantA, tenantB], contactsA, contactsB) => {
            // Populate the in-memory store with contacts tagged by tenant_id
            _store = [
              ...contactsA.map((c) => ({ ...c, tenant_id: tenantA })),
              ...contactsB.map((c) => ({ ...c, tenant_id: tenantB })),
            ];

            // Reset filter state before each call
            mockChain._tenantFilter = null;

            // Call list as tenant A
            const reqA = { tenantId: tenantA };
            const resA = mockRes();
            const nextA = mockNext();
            await contactsController.list(reqA, resA, nextA);

            const returnedContacts = resA.json.mock.calls[0][0];

            // None of the returned contacts should belong to tenant B
            const hasTenantBContact = returnedContacts.some((c) => c.tenant_id === tenantB);
            expect(hasTenantBContact).toBe(false);

            // All returned contacts should belong to tenant A (or list is empty)
            const allBelongToA = returnedContacts.every((c) => c.tenant_id === tenantA);
            expect(allBelongToA).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );
});
