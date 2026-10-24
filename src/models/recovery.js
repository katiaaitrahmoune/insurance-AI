import { pool } from '../config/db.js';


export async function recoverInterruptedWork() {
  const runs = await pool.query(
    `UPDATE claim_analyses SET state = 'failed', completed_at = now(),
            error = 'The analysis was interrupted by a server restart. Please run it again.'
      WHERE state = 'running' RETURNING id`);
  const analyses = await pool.query(
    `UPDATE claims SET analysis_state = 'failed', stage = 'evidence_collection', updated_at = now()
      WHERE analysis_state = 'running' RETURNING id`);
  const reviews = await pool.query(
    `UPDATE claims SET analysis_state = 'awaiting_review', updated_at = now()
      WHERE analysis_state = 'reviewing' RETURNING id`);
  return { analyses: analyses.rows.map((r) => r.id), reviews: reviews.rows.map((r) => r.id), runs: runs.rowCount };
}
