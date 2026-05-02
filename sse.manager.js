/**
 * SSE Manager
 *
 * Maintains a Map<tenantId, Set<res>> of active Server-Sent Events response
 * streams. Provides three public functions:
 *   - addClient(tenantId, res)          — registers a response stream
 *   - removeClient(tenantId, res)       — deregisters on close
 *   - emit(tenantId, eventName, data)   — writes an SSE event to all tenant clients
 *
 * Requirements: 6.1, 6.4
 */

/** @type {Map<string, Set<import('express').Response>>} */
const clients = new Map();

/**
 * Register an SSE response stream for a tenant.
 *
 * @param {string} tenantId
 * @param {import('express').Response} res
 */
function addClient(tenantId, res) {
  if (!clients.has(tenantId)) {
    clients.set(tenantId, new Set());
  }
  clients.get(tenantId).add(res);
}

/**
 * Deregister an SSE response stream for a tenant.
 * Removes the Map entry entirely when the tenant's Set becomes empty.
 *
 * @param {string} tenantId
 * @param {import('express').Response} res
 */
function removeClient(tenantId, res) {
  const tenantClients = clients.get(tenantId);
  if (!tenantClients) return;

  tenantClients.delete(res);

  if (tenantClients.size === 0) {
    clients.delete(tenantId);
  }
}

/**
 * Write an SSE-formatted event to all response streams registered for a tenant.
 * This is a no-op (does not throw) when no clients are registered for the tenant.
 *
 * SSE format: `event: {eventName}\ndata: {JSON.stringify(data)}\n\n`
 *
 * @param {string} tenantId
 * @param {string} eventName
 * @param {object} data
 */
function emit(tenantId, eventName, data) {
  const tenantClients = clients.get(tenantId);
  if (!tenantClients || tenantClients.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of tenantClients) {
    res.write(payload);
  }
}

/**
 * Check whether at least one SSE client is connected for a tenant.
 *
 * @param {string} tenantId
 * @returns {boolean}
 */
function hasClients(tenantId) {
  const tenantClients = clients.get(tenantId);
  return !!(tenantClients && tenantClients.size > 0);
}

module.exports = { addClient, removeClient, emit, hasClients };
