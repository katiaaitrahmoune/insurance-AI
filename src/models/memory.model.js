import { pool } from '../config/db.js';

export async function insertMemories(db, claimId, rows) {
  for (const r of rows) {
    await db.query('INSERT INTO claim_memories (claim_id, memory_type, content) VALUES ($1,$2,$3)', [claimId, r.memory_type, r.content]);
  }
}

/** Past cases related by memory type and (optional) content keywords. Supporting signal only. */
export async function findRelated({ types = [], keywords = [], excludeClaimId = null, limit = 5 }) {
  const params = [];
  const where = [];
  if (excludeClaimId) { params.push(excludeClaimId); where.push(`claim_id <> $${params.length}`); }
  if (types.length) { params.push(types); where.push(`memory_type = ANY($${params.length}::text[])`); }
  if (keywords.length) {
    params.push(keywords.map((k) => `%${k}%`));
    where.push(`content ILIKE ANY($${params.length}::text[])`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, claim_id, memory_type, content, created_at FROM claim_memories
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function listForClaim(claimId) {
  return (await pool.query('SELECT * FROM claim_memories WHERE claim_id = $1 ORDER BY id', [claimId])).rows;
}
export async function deleteForClaim(db, claimId) {
  await db.query('DELETE FROM claim_memories WHERE claim_id = $1', [claimId]);
}
