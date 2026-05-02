/**
 * Nudge Job
 *
 * Runs every 5 minutes. Queries for past-due appointments that still have an
 * actionable status ('scheduled' or 'confirmed') and have not been nudged in
 * the last hour. For each such appointment, emits an SSE
 * `appointment-needs-update` event to the tenant's connected clients and
 * records the nudge timestamp so duplicates are suppressed.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6
 */

const supabase = require('../config/supabase');
const sseManager = require('../sse.manager');

const INTERVAL_MS = 300_000; // 5 minutes

/**
 * Start the nudge background job.
 * Returns the interval handle so callers can clear it in tests.
 *
 * @returns {NodeJS.Timeout}
 */
function startNudgeJob() {
  const handle = setInterval(async () => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: appointments, error } = await supabase
        .from('appointments')
        .select('*, contacts(*)')
        .lt('scheduled_at', new Date().toISOString())
        .in('status', ['scheduled', 'confirmed'])
        .or(`nudge_sent_at.is.null,nudge_sent_at.lt.${oneHourAgo}`);

      if (error) {
        console.error('❌ Nudge job — Supabase query failed:', error.message);
        return;
      }

      if (!appointments || appointments.length === 0) return;

      for (const row of appointments) {
        try {
          const tenantId = row.tenant_id;

          // Requirement 4.6 — skip if no SSE clients are connected for this tenant
          if (!sseManager.hasClients(tenantId)) continue;

          // Requirement 4.2 — emit nudge event
          sseManager.emit(tenantId, 'appointment-needs-update', {
            appointmentId: row.id,
            title: row.title,
            contactName: row.contacts?.name ?? null,
            scheduledAt: row.scheduled_at,
          });

          // Requirement 4.3 — record nudge timestamp to prevent duplicates within 1 hour
          const { error: updateError } = await supabase
            .from('appointments')
            .update({ nudge_sent_at: new Date().toISOString() })
            .eq('id', row.id);

          if (updateError) {
            console.error(
              `❌ Nudge job — failed to update nudge_sent_at for appointment ${row.id}:`,
              updateError.message
            );
          }
        } catch (rowErr) {
          // Per-row errors must not crash the whole interval tick
          console.error(
            `❌ Nudge job — error processing appointment ${row.id}:`,
            rowErr.message
          );
        }
      }
    } catch (err) {
      // Top-level catch so the interval is never killed by an unexpected error
      console.error('❌ Nudge job — unexpected error:', err.message);
    }
  }, INTERVAL_MS);

  return handle;
}

module.exports = { startNudgeJob };
