import { pool } from '../config/db.js';
export async function logAudit(claimId, actor, action, detail = {}, db = pool) {
  await db.query('INSERT INTO audit_log (claim_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [claimId, actor, action, JSON.stringify(detail)]);
}
export async function recentAudit(limit = 10) {
  return (await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [limit])).rows;
}
