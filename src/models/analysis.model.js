import { pool } from '../config/db.js';

export async function createAnalysis(claimId, db = pool) {
  return (await db.query('INSERT INTO claim_analyses (claim_id) VALUES ($1) RETURNING *', [claimId])).rows[0];
}

export async function latestAnalysis(claimId, db = pool) {
  return (await db.query('SELECT * FROM claim_analyses WHERE claim_id = $1 ORDER BY id DESC LIMIT 1', [claimId])).rows[0] ?? null;
}

const PARTS = new Set(['vision', 'policy', 'decision']);
export async function savePart(analysisId, part, json, db = pool) {
  if (!PARTS.has(part)) throw new Error(`unknown analysis part ${part}`);
  await db.query(`UPDATE claim_analyses SET ${part} = $2 WHERE id = $1`, [analysisId, JSON.stringify(json)]);
}

/** Append an event and return its sequence number (index in the events array). */
export async function appendEvent(analysisId, event) {
  const { rows } = await pool.query(
    `UPDATE claim_analyses SET events = events || $2::jsonb WHERE id = $1
     RETURNING jsonb_array_length(events) - 1 AS seq`,
    [analysisId, JSON.stringify([event])],
  );
  return rows[0].seq;
}

export async function finishAnalysis(analysisId, state, error = null, db = pool) {
  await db.query('UPDATE claim_analyses SET state = $2, error = $3, completed_at = now() WHERE id = $1', [analysisId, state, error]);
}

export async function saveHumanDecision(analysisId, decision, db = pool) {
  await db.query(
    "UPDATE claim_analyses SET human_decision = $2, state = 'reviewed' WHERE id = $1",
    [analysisId, JSON.stringify(decision)],
  );
}
