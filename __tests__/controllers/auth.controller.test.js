// Unit tests for auth.controller
// Validates: Requirements 3.1, 3.2, 3.3, 3.6

// Mock supabase config to prevent env var errors during module load
jest.mock('../../config/supabase', () => ({ from: jest.fn() }));

jest.mock('../../services/auth.service');

const authService = require('../../services/auth.service');
const authController = require('../../controllers/auth.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    test('success returns 201 with { token }', async () => {
      const result = { token: 'jwt-token' };
      authService.register.mockResolvedValue(result);
      const req = { body: { name: 'Alice', email: 'alice@example.com', password: 'password123', tenantName: 'Acme' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.register(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(result);
      expect(next).not.toHaveBeenCalled();
    });

    test('service error calls next(err)', async () => {
      const err = new Error('DB error');
      authService.register.mockRejectedValue(err);
      const req = { body: { name: 'Alice', email: 'alice@example.com', password: 'password123', tenantName: 'Acme' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.register(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    test('success returns 200 with { token }', async () => {
      const result = { token: 'jwt-token' };
      authService.login.mockResolvedValue(result);
      const req = { body: { email: 'alice@example.com', password: 'password123' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(result);
      expect(next).not.toHaveBeenCalled();
    });

    test('wrong password (err.status=401) returns 401 with { message }', async () => {
      const err = new Error('Invalid credentials');
      err.status = 401;
      authService.login.mockRejectedValue(err);
      const req = { body: { email: 'alice@example.com', password: 'wrongpassword' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
      expect(next).not.toHaveBeenCalled();
    });

    test('unknown email (err.status=401) returns 401 with { message }', async () => {
      const err = new Error('Invalid credentials');
      err.status = 401;
      authService.login.mockRejectedValue(err);
      const req = { body: { email: 'unknown@example.com', password: 'password123' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
      expect(next).not.toHaveBeenCalled();
    });

    test('non-auth error calls next(err)', async () => {
      const err = new Error('Database connection failed');
      authService.login.mockRejectedValue(err);
      const req = { body: { email: 'alice@example.com', password: 'password123' } };
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
