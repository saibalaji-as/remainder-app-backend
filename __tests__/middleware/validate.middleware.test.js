// Feature: b2b-appointment-reminder-backend, Property 14: Validation middleware rejects invalid inputs with 422

const fc = require('fast-check');

// Mock express-validator before requiring the middleware
jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

const { validationResult } = require('express-validator');
const validateMiddleware = require('../../middleware/validate.middleware');

describe('validate.middleware - Property 14: Validation middleware rejects invalid inputs with 422', () => {
  test('responds 422 with non-empty errors array when validation errors exist', () => {
    fc.assert(
      fc.property(
        fc.record({ errors: fc.array(fc.string(), { minLength: 1 }) }),
        ({ errors }) => {
          // Mock validationResult to return a non-empty errors result
          validationResult.mockReturnValue({
            isEmpty: () => false,
            array: () => errors,
          });

          const req = {};
          const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
          };
          const next = jest.fn();

          validateMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(422);
          const jsonArg = res.json.mock.calls[0][0];
          expect(jsonArg).toHaveProperty('errors');
          expect(Array.isArray(jsonArg.errors)).toBe(true);
          expect(jsonArg.errors.length).toBeGreaterThan(0);
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('calls next() when there are no validation errors', () => {
    validationResult.mockReturnValue({
      isEmpty: () => true,
      array: () => [],
    });

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    validateMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
