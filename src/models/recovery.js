import { pool } from '../config/db.js';

/**
 * Hosted platforms restart and sleep processes. Analysis and review run in-process, so a restart can
 * strand a claim mid-flight. On boot (single replica) we put such claims back into a retryable state.
 * Nothing here touches claims.status.
 */
export async function recoverInterruptedWork() {
  const runs = await pool.query(
    `UPDATE claim_analyses SET state = 'failed', completed_at = now(),
            error = 'The analysis was interrupted by a server restart. Please run it again.'
      WHERE state = 'running' RETURNING id`);
  const analyses = await pool.query(
    `UPDATE claims SET analysis_state = 'failed', stage = 'evidence_collection', updated_at = now()
      WHERE analysis_state = 'running' RETURNING id`);
  // A review that died before finishing is safe to retry: update_claim is idempotent.
  const reviews = await pool.query(
    `UPDATE claims SET analysis_state = 'awaiting_review', updated_at = now()
      WHERE analysis_state = 'reviewing' RETURNING id`);
  return { analyses: analyses.rows.map((r) => r.id), reviews: reviews.rows.map((r) => r.id), runs: runs.rowCount };
}
