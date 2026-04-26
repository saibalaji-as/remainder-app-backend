jest.mock('../../config/supabase', () => ({ from: jest.fn() }));

const supabase = require('../../config/supabase');
const contactsController = require('../../controllers/contacts.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function makeChain(result) {
  const chain = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.delete = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

function makeListChain(result) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe('contacts.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('returns 201 with created contact', async () => {
      const contact = { id: 1, tenant_id: 10, name: 'Alice', email: 'alice@example.com', phone: '555-0001' };
      const chain = makeChain({ data: contact, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, body: { name: 'Alice', email: 'alice@example.com', phone: '555-0001' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.create(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('contacts');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(contact);
    });
  });

  describe('list', () => {
    test('returns contacts scoped to tenantId', async () => {
      const contacts = [
        { id: 1, tenant_id: 10, name: 'Alice' },
        { id: 2, tenant_id: 10, name: 'Bob' },
      ];
      const chain = makeListChain({ data: contacts, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10 };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.list(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('contacts');
      expect(res.json).toHaveBeenCalledWith(contacts);
    });
  });

  describe('getById', () => {
    test('returns contact when found', async () => {
      const contact = { id: 1, tenant_id: 10, name: 'Alice' };
      const chain = makeChain({ data: contact, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.getById(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('contacts');
      expect(res.json).toHaveBeenCalledWith(contact);
    });

    test('returns 404 when contact not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '999' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.getById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });

  describe('update', () => {
    test('returns updated contact', async () => {
      const updated = { id: 1, tenant_id: 10, name: 'Alice Updated' };
      const chain = makeChain({ data: updated, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' }, body: { name: 'Alice Updated' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.update(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('contacts');
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    test('returns 404 when contact not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '999' }, body: { name: 'X' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.update(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });

  describe('remove', () => {
    test('returns 204 on success', async () => {
      const contact = { id: 1, tenant_id: 10, name: 'Alice' };
      const chain = makeChain({ data: contact, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.remove(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('contacts');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    test('returns 404 when contact not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '999' } };
      const res = mockRes();
      const next = jest.fn();

      await contactsController.remove(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });
});
