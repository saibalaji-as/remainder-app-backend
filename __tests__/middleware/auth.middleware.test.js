// Feature: b2b-appointment-reminder-backend, Property 1: JWT payload round-trip through middleware

const fc = require('fast-check');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-secret-key';

// Set JWT_SECRET before requiring modules
process.env.JWT_SECRET = TEST_SECRET;

// Mock auth.service so verifyToken uses the test secret
// Note: jest.mock is hoisted, so we use require() inside the factory
jest.mock('../../services/auth.service', () => ({
  verifyToken: (token) => require('jsonwebtoken').verify(token, 'test-secret-key'),
}));

const authMiddleware = require('../../middleware/auth.middleware');

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('auth.middleware', () => {
  // --- Missing / malformed Authorization header → 401 ---
  test('returns 401 { message: "Invalid or expired token" } when Authorization header is absent', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({}),
          fc.string().filter(s => !s.startsWith('Bearer ')).map(s => ({ authorization: s }))
        ),
        (headers) => {
          const req = { headers };
          const res = makeRes();
          const next = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- Property 1: valid Bearer token → req.user = decoded payload, next() called ---
  test('Property 1: sets req.user and calls next() for valid token', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.uuid(),
          tenantId: fc.uuid(),
          email: fc.emailAddress(),
          role: fc.constantFrom('owner', 'member'),
        }),
        (payload) => {
          const token = jwt.sign(payload, TEST_SECRET);
          const req = { headers: { authorization: `Bearer ${token}` } };
          const res = makeRes();
          const next = jest.fn();

          authMiddleware(req, res, next);

          expect(next).toHaveBeenCalled();
          expect(req.user).toMatchObject(payload);
          expect(res.status).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- Invalid / expired token → 401 ---
  test('returns 401 { message: "Invalid or expired token" } for invalid token', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => {
          try { jwt.verify(s, TEST_SECRET); return false; } catch { return true; }
        }),
        (badToken) => {
          const req = { headers: { authorization: `Bearer ${badToken}` } };
          const res = makeRes();
          const next = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- Example: expired token ---
  test('returns 401 { message: "Invalid or expired token" } for an expired token', () => {
    const expiredToken = jwt.sign({ userId: '1', tenantId: 't1' }, TEST_SECRET, { expiresIn: -1 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });
});
