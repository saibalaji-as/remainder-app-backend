'use strict';

const supabase = require('../config/supabase');

// ---------------------------------------------------------------------------
// Date utility helpers (internal — not exported)
// ---------------------------------------------------------------------------

/**
 * Returns the Monday 00:00:00 UTC of the ISO week containing `date`.
 * @param {Date} date
 * @returns {Date}
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the Sunday 23:59:59.999 UTC of the ISO week containing `date`.
 * @param {Date} date
 * @returns {Date}
 */
function getWeekEnd(date) {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Returns { currentWeekStart, currentWeekEnd, prevWeekStart, prevWeekEnd }
 * for the current UTC date.
 * @returns {{ currentWeekStart: Date, currentWeekEnd: Date, prevWeekStart: Date, prevWeekEnd: Date }}
 */
function getWeekBoundaries() {
  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  const currentWeekEnd = getWeekEnd(now);
  const prevWeekEnd = new Date(currentWeekStart);
  prevWeekEnd.setUTCMilliseconds(-1);
  const prevWeekStart = getWeekStart(prevWeekEnd);
  return { currentWeekStart, currentWeekEnd, prevWeekStart, prevWeekEnd };
}

/**
 * Returns { windowStart, windowEnd } for a 7-day window ending today (inclusive).
 * windowStart = today-6 days at 00:00:00.000 UTC
 * windowEnd   = today at 23:59:59.999 UTC
 * @returns {{ windowStart: Date, windowEnd: Date }}
 */
function get7DayWindow() {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return { windowStart: start, windowEnd: end };
}

/**
 * Returns { monthStart, monthEnd } for the current UTC calendar month.
 * monthStart = first day of month at 00:00:00.000 UTC
 * monthEnd   = last day of month at 23:59:59.999 UTC
 * @returns {{ monthStart: Date, monthEnd: Date }}
 */
function getCurrentMonthBoundaries() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { monthStart, monthEnd };
}

// ---------------------------------------------------------------------------
// Delivery rate helper (internal — not exported)
// ---------------------------------------------------------------------------

/**
 * Computes delivery rate as a percentage, rounded to 1 decimal place.
 * Returns 0.0 if nonPendingCount is zero (zero-division guard).
 * @param {number} deliveredCount
 * @param {number} nonPendingCount
 * @returns {number}
 */
function computeDeliveryRate(deliveredCount, nonPendingCount) {
  if (nonPendingCount === 0) return 0.0;
  return Math.round((deliveredCount / nonPendingCount) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Trend helper (internal — not exported)
// ---------------------------------------------------------------------------

/**
 * Computes a trend object from current and previous week values.
 * @param {number} current - current week value
 * @param {number} previous - previous week value
 * @returns {{ value: number|null, direction: 'up'|'down'|'neutral' }}
 */
function computeTrend(current, previous) {
  if (previous === 0) {
    return { value: null, direction: 'neutral' };
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
  return { value: pct, direction };
}

// ---------------------------------------------------------------------------
// Data-fetch helpers (internal — not exported)
// ---------------------------------------------------------------------------

/**
 * Fetches all-time stat counts for the given tenant in parallel.
 * Runs 6 Supabase count queries concurrently via Promise.all.
 *
 * @param {string} tenantId
 * @returns {Promise<{
 *   totalContacts: number,
 *   totalAppointments: number,
 *   totalRemindersSent: number,
 *   totalRemindersFailed: number,
 *   deliveredCount: number,
 *   nonPendingCount: number
 * }>}
 */
async function fetchStatsCounts(tenantId) {
  const [
    contactsResult,
    appointmentsResult,
    sentResult,
    failedResult,
    deliveredResult,
    nonPendingResult,
  ] = await Promise.all([
    // 1. Total contacts for tenant
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),

    // 2. Total appointments for tenant
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),

    // 3. Reminders with status = 'sent' (scoped via appointments join)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'sent'),

    // 4. Reminders with status = 'failed' (scoped via appointments join)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'failed'),

    // 5. Reminders with status = 'delivered' (delivery rate numerator)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'delivered'),

    // 6. Non-pending reminders (delivery rate denominator)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .neq('status', 'pending'),
  ]);

  const { count: totalContacts, error: e1 } = contactsResult;
  if (e1) throw e1;

  const { count: totalAppointments, error: e2 } = appointmentsResult;
  if (e2) throw e2;

  const { count: totalRemindersSent, error: e3 } = sentResult;
  if (e3) throw e3;

  const { count: totalRemindersFailed, error: e4 } = failedResult;
  if (e4) throw e4;

  const { count: deliveredCount, error: e5 } = deliveredResult;
  if (e5) throw e5;

  const { count: nonPendingCount, error: e6 } = nonPendingResult;
  if (e6) throw e6;

  return {
    totalContacts,
    totalAppointments,
    totalRemindersSent,
    totalRemindersFailed,
    deliveredCount,
    nonPendingCount,
  };
}

/**
 * Fetches week-over-week appointment and reminder-sent counts for trend calculation.
 * Runs 4 Supabase count queries concurrently via Promise.all.
 *
 * @param {string} tenantId
 * @param {Date} currentWeekStart
 * @param {Date} currentWeekEnd
 * @param {Date} prevWeekStart
 * @param {Date} prevWeekEnd
 * @returns {Promise<{
 *   currAppts: number,
 *   prevAppts: number,
 *   currSent: number,
 *   prevSent: number
 * }>}
 */
async function fetchTrendCounts(tenantId, currentWeekStart, currentWeekEnd, prevWeekStart, prevWeekEnd) {
  const [
    currApptsResult,
    prevApptsResult,
    currSentResult,
    prevSentResult,
  ] = await Promise.all([
    // 1. Current week appointments
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('scheduled_at', currentWeekStart.toISOString())
      .lte('scheduled_at', currentWeekEnd.toISOString()),

    // 2. Previous week appointments
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('scheduled_at', prevWeekStart.toISOString())
      .lte('scheduled_at', prevWeekEnd.toISOString()),

    // 3. Current week reminders sent (scoped via appointments join)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'sent')
      .gte('sent_at', currentWeekStart.toISOString())
      .lte('sent_at', currentWeekEnd.toISOString()),

    // 4. Previous week reminders sent (scoped via appointments join)
    supabase
      .from('reminders')
      .select('*, appointments!inner(tenant_id)', { count: 'exact', head: true })
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'sent')
      .gte('sent_at', prevWeekStart.toISOString())
      .lte('sent_at', prevWeekEnd.toISOString()),
  ]);

  const { count: currAppts, error: e1 } = currApptsResult;
  if (e1) throw e1;

  const { count: prevAppts, error: e2 } = prevApptsResult;
  if (e2) throw e2;

  const { count: currSent, error: e3 } = currSentResult;
  if (e3) throw e3;

  const { count: prevSent, error: e4 } = prevSentResult;
  if (e4) throw e4;

  return { currAppts, prevAppts, currSent, prevSent };
}

/**
 * Fetches raw appointment and reminder rows for the 7-day graph window.
 * Runs 2 Supabase queries in parallel via Promise.all.
 *
 * @param {string} tenantId
 * @param {Date} windowStart - start of 7-day window (inclusive)
 * @param {Date} windowEnd   - end of 7-day window (inclusive)
 * @returns {Promise<{ apptRows: object[], reminderRows: object[] }>}
 */
async function fetchGraphData(tenantId, windowStart, windowEnd) {
  const [apptsResult, remindersResult] = await Promise.all([
    // 1. Appointments in the 7-day window
    supabase
      .from('appointments')
      .select('scheduled_at')
      .eq('tenant_id', tenantId)
      .gte('scheduled_at', windowStart.toISOString())
      .lte('scheduled_at', windowEnd.toISOString()),

    // 2. Sent reminders in the 7-day window (scoped via appointments join)
    supabase
      .from('reminders')
      .select('sent_at, appointments!inner(tenant_id)')
      .eq('appointments.tenant_id', tenantId)
      .eq('status', 'sent')
      .gte('sent_at', windowStart.toISOString())
      .lte('sent_at', windowEnd.toISOString()),
  ]);

  const { data: apptRows, error: e1 } = apptsResult;
  if (e1) throw e1;

  const { data: reminderRows, error: e2 } = remindersResult;
  if (e2) throw e2;

  return { apptRows, reminderRows };
}

/**
 * Fetches raw reminder rows for the current-month pie chart breakdown.
 * Queries the `reminders` table joined with `appointments` for tenant scoping.
 *
 * @param {string} tenantId
 * @param {Date} monthStart - first moment of the current calendar month (UTC)
 * @param {Date} monthEnd   - last moment of the current calendar month (UTC)
 * @returns {Promise<object[]>} raw reminder rows with `channel` field
 */
async function fetchPieData(tenantId, monthStart, monthEnd) {
  const { data, error } = await supabase
    .from('reminders')
    .select('channel, appointments!inner(tenant_id)')
    .eq('appointments.tenant_id', tenantId)
    .gte('sent_at', monthStart.toISOString())
    .lte('sent_at', monthEnd.toISOString());

  if (error) throw error;

  return data;
}

/**
 * Fetches the next 5 upcoming appointments for the tenant, with contact info.
 * Ordered by `scheduled_at` ascending; only returns appointments in the future.
 *
 * @param {string} tenantId
 * @returns {Promise<Array<{ id: string, title: string, scheduled_at: string, contact: { name: string|null, phone: string|null } }>>}
 */
async function fetchUpcomingAppointments(tenantId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, title, scheduled_at, contacts(name, phone)')
    .eq('tenant_id', tenantId)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(5);

  if (error) throw error;

  return (data || []).map(r => ({
    id: r.id,
    title: r.title,
    scheduled_at: r.scheduled_at,
    contact: {
      name: r.contacts?.name ?? null,
      phone: r.contacts?.phone ?? null,
    },
  }));
}

/**
 * Fetches the 10 most recent reminder records for the tenant.
 * Ordered by `sent_at` descending; scoped via appointments join.
 *
 * @param {string} tenantId
 * @returns {Promise<object[]>} reminder rows with id, status, sent_at, appointment_id
 */
async function fetchRecentReminders(tenantId) {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, status, sent_at, appointment_id, appointments!inner(tenant_id)')
    .eq('appointments.tenant_id', tenantId)
    .order('sent_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  return data || [];
}

// ---------------------------------------------------------------------------
// Response assembly helpers (internal — not exported)
// ---------------------------------------------------------------------------

/**
 * Assembles the stats card object from raw counts and trend counts.
 *
 * @param {{
 *   totalContacts: number,
 *   totalAppointments: number,
 *   totalRemindersSent: number,
 *   totalRemindersFailed: number,
 *   deliveredCount: number,
 *   nonPendingCount: number
 * }} countsResult
 * @param {{
 *   currAppts: number,
 *   prevAppts: number,
 *   currSent: number,
 *   prevSent: number
 * }} trendResult
 * @returns {{
 *   totalContacts: number,
 *   totalAppointments: number,
 *   totalRemindersSent: number,
 *   totalRemindersFailed: number,
 *   deliveryRate: number,
 *   trends: {
 *     totalAppointments: { value: number|null, direction: string },
 *     totalRemindersSent: { value: number|null, direction: string },
 *     deliveryRate: { value: number|null, direction: string }
 *   }
 * }}
 */
function buildStats(countsResult, trendResult) {
  const deliveryRate = computeDeliveryRate(countsResult.deliveredCount, countsResult.nonPendingCount);

  return {
    totalContacts: countsResult.totalContacts,
    totalAppointments: countsResult.totalAppointments,
    totalRemindersSent: countsResult.totalRemindersSent,
    totalRemindersFailed: countsResult.totalRemindersFailed,
    deliveryRate,
    trends: {
      totalAppointments: computeTrend(trendResult.currAppts, trendResult.prevAppts),
      totalRemindersSent: computeTrend(trendResult.currSent, trendResult.prevSent),
      deliveryRate: { value: null, direction: 'neutral' },
    },
  };
}

const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Builds the 7-day graph data array from raw appointment and reminder rows.
 * The map is built from `windowStart` (day 0) through `windowStart + 6 days` (day 6),
 * making the function deterministic and testable.
 *
 * @param {{ apptRows: object[], reminderRows: object[] }} graphResult
 * @param {Date} windowStart - the start of the 7-day window (00:00:00 UTC, 6 days ago)
 * @returns {Array<{ day: string, date: string, appts: number, reminders: number }>}
 */
function buildGraphData(graphResult, windowStart) {
  const { apptRows, reminderRows } = graphResult;

  // Build a map keyed by YYYY-MM-DD for each of the 7 days in the window
  const dayMap = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(windowStart);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    dayMap[dateStr] = { day: DAY_ABBREVS[d.getUTCDay()], date: dateStr, appts: 0, reminders: 0 };
  }

  // Aggregate appointment counts per day
  for (const row of apptRows) {
    const dateStr = row.scheduled_at.slice(0, 10);
    if (dayMap[dateStr]) dayMap[dateStr].appts++;
  }

  // Aggregate reminder counts per day
  for (const row of reminderRows) {
    const dateStr = row.sent_at.slice(0, 10);
    if (dayMap[dateStr]) dayMap[dateStr].reminders++;
  }

  return Object.values(dayMap); // 7 entries, oldest-first
}

/**
 * Builds the pie chart data object from raw reminder rows.
 * Counts reminders by channel (sms or email).
 *
 * @param {object[]|null} rows - raw reminder rows with a `channel` field
 * @returns {{ sms: number, email: number }}
 */
function buildPieData(rows) {
  const pieData = { sms: 0, email: 0 };

  if (!rows) return pieData;

  for (const row of rows) {
    if (row.channel === 'sms') pieData.sms++;
    else if (row.channel === 'email') pieData.email++;
  }

  return pieData;
}

// ---------------------------------------------------------------------------
// Main controller function
// ---------------------------------------------------------------------------

/**
 * GET /api/dashboard/stats
 *
 * Aggregates all dashboard data for the authenticated tenant and returns a
 * single JSON response containing stats cards, graph data, pie chart data,
 * upcoming appointments, and recent reminders.
 *
 * Reads tenant identity exclusively from `req.tenantId` (set by tenant middleware).
 * All independent Supabase query groups run in parallel via Promise.all.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getDashboardStats(req, res) {
  try {
    const tenantId = req.tenantId;
    const { currentWeekStart, currentWeekEnd, prevWeekStart, prevWeekEnd } = getWeekBoundaries();
    const { windowStart, windowEnd } = get7DayWindow();
    const { monthStart, monthEnd } = getCurrentMonthBoundaries();

    const [
      countsResult,
      trendResult,
      graphResult,
      pieResult,
      upcomingAppointments,
      recentReminders,
    ] = await Promise.all([
      fetchStatsCounts(tenantId),
      fetchTrendCounts(tenantId, currentWeekStart, currentWeekEnd, prevWeekStart, prevWeekEnd),
      fetchGraphData(tenantId, windowStart, windowEnd),
      fetchPieData(tenantId, monthStart, monthEnd),
      fetchUpcomingAppointments(tenantId),
      fetchRecentReminders(tenantId),
    ]);

    const stats = buildStats(countsResult, trendResult);
    const graphData = buildGraphData(graphResult, windowStart);
    const pieData = buildPieData(pieResult);

    return res.json({
      stats,
      graphData,
      pieData,
      upcomingAppointments,
      recentReminders,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { getDashboardStats };

// Expose internals for unit testing only
if (process.env.NODE_ENV === 'test') {
  module.exports.__testExports = {
    getWeekBoundaries,
    get7DayWindow,
    getCurrentMonthBoundaries,
    computeDeliveryRate,
    computeTrend,
    buildGraphData,
    buildStats,
    buildPieData,
  };
}
