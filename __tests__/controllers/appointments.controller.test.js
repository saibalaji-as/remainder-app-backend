jest.mock('../../config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../services/appointment.service', () => ({ createAppointment: jest.fn() }));
jest.mock('../../jobs/reminder.queue', () => ({ addReminderJob: jest.fn() }));

const supabase = require('../../config/supabase');
const appointmentService = require('../../services/appointment.service');
const appointmentsController = require('../../controllers/appointments.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

// For methods ending in .single()
function makeChain(result) {
  const chain = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.delete = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

// For list which resolves as a thenable (no .single())
function makeListChain(result) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe('appointments.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('returns 201 and calls appointmentService.createAppointment with correct args', async () => {
      const appointment = { id: 1, tenant_id: 10, contact_id: 5, title: 'Checkup', scheduled_at: '2025-12-01T10:00:00Z', reminder_channel: 'email' };
      appointmentService.createAppointment.mockResolvedValue(appointment);

      const req = {
        tenantId: 10,
        body: { contactId: 5, title: 'Checkup', scheduledAt: '2025-12-01T10:00:00Z', reminderChannel: 'email' },
      };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.create(req, res, next);

      expect(appointmentService.createAppointment).toHaveBeenCalledWith({
        tenantId: 10,
        contactId: 5,
        title: 'Checkup',
        scheduledAt: '2025-12-01T10:00:00Z',
        reminderChannel: 'email',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(appointment);
    });
  });

  describe('list', () => {
    test('returns appointments with contacts included', async () => {
      const appointments = [
        { id: 1, tenant_id: 10, title: 'Checkup', contacts: { id: 5, name: 'Alice' } },
        { id: 2, tenant_id: 10, title: 'Follow-up', contacts: { id: 6, name: 'Bob' } },
      ];
      const chain = makeListChain({ data: appointments, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10 };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.list(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('appointments');
      expect(res.json).toHaveBeenCalledWith(appointments);
    });
  });

  describe('getById', () => {
    test('returns appointment when found', async () => {
      const appointment = { id: 1, tenant_id: 10, title: 'Checkup' };
      const chain = makeChain({ data: appointment, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.getById(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('appointments');
      expect(res.json).toHaveBeenCalledWith(appointment);
    });

    test('returns 404 when appointment not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 99, params: { id: '999' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.getById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });

  describe('update', () => {
    test('returns updated appointment', async () => {
      const updated = { id: 1, tenant_id: 10, title: 'Updated Checkup' };
      const chain = makeChain({ data: updated, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' }, body: { title: 'Updated Checkup' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.update(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('appointments');
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    test('returns 404 when appointment not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 99, params: { id: '999' }, body: { title: 'X' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.update(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });

  describe('remove', () => {
    test('returns 204 on success', async () => {
      const appointment = { id: 1, tenant_id: 10, title: 'Checkup' };
      const chain = makeChain({ data: appointment, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 10, params: { id: '1' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.remove(req, res, next);

      expect(supabase.from).toHaveBeenCalledWith('appointments');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    test('returns 404 when appointment not found (data is null)', async () => {
      const chain = makeChain({ data: null, error: null });
      supabase.from.mockReturnValue(chain);

      const req = { tenantId: 99, params: { id: '999' } };
      const res = mockRes();
      const next = jest.fn();

      await appointmentsController.remove(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not found' });
    });
  });
});
