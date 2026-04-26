// Feature: b2b-appointment-reminder-backend, Property 2: Tenant middleware propagation

const fc = require('fast-check');
const tenantMiddleware = require('../../middleware/tenant.middleware');

describe('tenant.middleware - Property 2: Tenant middleware propagation', () => {
  test('req.tenantId equals req.user.tenantId for any tenantId value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1 }),
        (tenantId) => {
          const req = { user: { tenantId } };
          const res = {};
          const next = jest.fn();

          tenantMiddleware(req, res, next);

          expect(next).toHaveBeenCalled();
          expect(req.tenantId).toBe(req.user.tenantId);
          expect(req.tenantId).toBe(tenantId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
