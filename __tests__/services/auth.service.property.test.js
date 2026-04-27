// Feature: b2b-appointment-reminder-backend

const fc = require('fast-check');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_EXPIRES_IN = '7d';

// Mock Supabase with a chainable query builder
const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

// Mock bcryptjs to use saltRounds: 1 for speed, but still use real bcrypt logic
jest.mock('bcryptjs', () => {
  const real = jest.requireActual('bcryptjs');
  return {
    ...real,
    hash: (plain, _rounds) => real.hash(plain, 1),
  };
});

const authService = require('../../services/auth.service');
const realBcrypt = jest.requireActual('bcryptjs');

// Helper: build a chainable Supabase query mock resolving to { data, error }
function makeChain(result) {
  const chain = {};
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 4: Registration creates isolated tenant and hashed password
// Feature: b2b-appointment-reminder-backend, Property 4: Registration creates isolated tenant and hashed password
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------
describe('Property 4: Registration creates isolated tenant and hashed password', () => {
  test('passwordHash !== password, bcrypt verifies hash, tenant record inserted, user linked to tenant, JWT is valid', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string(),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 8 }),
          tenantName: fc.string(),
        }),
        async ({ name, email, password, tenantName }) => {
          jest.clearAllMocks();

          const tenantId = 'tenant-' + Math.random().toString(36).slice(2);
          const userId = 'user-' + Math.random().toString(36).slice(2);

          const tenantChain = makeChain({
            data: { id: tenantId, name: tenantName },
            error: null,
          });

          // Capture the insert payload for tenant and user
          let tenantInsertPayload = null;
          let userInsertPayload = null;
          let capturedPasswordHash = null;

          tenantChain.insert.mockImplementation((payload) => {
            tenantInsertPayload = payload;
            return tenantChain;
          });

          const userChain = makeChain({
            data: { id: userId, name, email, tenant_id: tenantId, password_hash: 'placeholder' },
            error: null,
          });

          userChain.insert.mockImplementation((payload) => {
            userInsertPayload = payload;
            capturedPasswordHash = payload.password_hash;
            // Return a chain that resolves with the actual hash in data
            const resolvedChain = makeChain({
              data: { id: userId, name, email, tenant_id: tenantId, password_hash: payload.password_hash },
              error: null,
            });
            return resolvedChain;
          });

          mockFrom.mockReturnValueOnce(tenantChain).mockReturnValueOnce(userChain);

          const result = await authService.register({ name, email, password, tenantName });

          // Tenant record was inserted with the correct name
          expect(tenantInsertPayload).toMatchObject({ name: tenantName });

          // User was linked to the tenant
          expect(userInsertPayload).toMatchObject({
            tenant_id: tenantId,
            name,
            email,
          });
          expect(userInsertPayload).toHaveProperty('password_hash');

          // passwordHash !== plaintext password
          expect(capturedPasswordHash).not.toBe(password);

          // bcrypt verifies the hash against the original password
          const isValid = await realBcrypt.compare(password, capturedPasswordHash);
          expect(isValid).toBe(true);

          // JWT is valid and contains expected claims
          expect(typeof result.token).toBe('string');
          const decoded = jwt.verify(result.token, process.env.JWT_SECRET);
          expect(decoded.userId).toBe(userId);
          expect(decoded.tenantId).toBe(tenantId);
          expect(decoded.email).toBe(email);
        }
      ),
      { numRuns: 100 }
    );
  }, 180000);
});

// ---------------------------------------------------------------------------
// Property 5: Login JWT payload correctness
// Feature: b2b-appointment-reminder-backend, Property 5: Login JWT payload correctness
// Validates: Requirements 3.2
// ---------------------------------------------------------------------------
describe('Property 5: Login JWT payload correctness', () => {
  const sharedPassword = 'SharedPass123!';
  let sharedHash;

  beforeAll(async () => {
    sharedHash = await realBcrypt.hash(sharedPassword, 1);
  });

  test('decoded JWT payload contains userId, tenantId, email matching stored record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          tenantId: fc.uuid(),
          email: fc.emailAddress(),
        }),
        async ({ userId, tenantId, email }) => {
          jest.clearAllMocks();

          const loginChain = makeChain({
            data: {
              id: userId,
              tenant_id: tenantId,
              name: 'Test User',
              email,
              password_hash: sharedHash,
            },
            error: null,
          });

          mockFrom.mockReturnValue(loginChain);

          const result = await authService.login({ email, password: sharedPassword });

          // JWT is a valid string
          expect(typeof result.token).toBe('string');

          // Decoded JWT payload matches the stored record
          const decoded = jwt.verify(result.token, process.env.JWT_SECRET);
          expect(decoded.userId).toBe(userId);
          expect(decoded.tenantId).toBe(tenantId);
          expect(decoded.email).toBe(email);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
