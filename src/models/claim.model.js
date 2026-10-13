import { pool } from '../config/db.js';

// NOTE: no function in this file ever writes claims.status. That column belongs to update_claim.

export async function nextClaimId(db = pool) {
  const { rows } = await db.query("SELECT 'CLM-' || nextval('claim_number_seq') AS id");
  return rows[0].id;
}

export async function insertClaim(db, c) {
  const { rows } = await db.query(
    `INSERT INTO claims (id, customer_name, vehicle, description, policy_id, priority, incident_type,
                         estimated_amount, stage, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.id, c.customer_name, c.vehicle, c.description ?? '', c.policy_id, c.priority ?? 'medium',
     c.incident_type ?? 'other', c.estimated_amount ?? null, c.stage ?? 'evidence_collection', c.created_by ?? null],
  );
  return rows[0];
}

export async function getClaimRow(id, db = pool) {
  const { rows } = await db.query('SELECT * FROM claims WHERE id = $1', [id]);
  return rows[0] ?? null;
}

const SORTS = {
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  amount: 'c.estimated_amount',
  priority: "CASE c.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
};

export async function listClaims(f) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  const stage = f.tab && f.tab !== 'all' ? f.tab : f.stage;
  if (stage && stage !== 'all') add('c.stage = ?', stage);
  if (f.priority && f.priority !== 'all') add('c.priority = ?', f.priority);
  if (f.status && f.status !== 'all') add('c.status = ?', f.status);
  if (f.incident_type && f.incident_type !== 'all') add('c.incident_type = ?', f.incident_type);
  if (f.q) {
    params.push(`%${f.q}%`);
    const i = params.length;
    where.push(`(c.id ILIKE $${i} OR c.customer_name ILIKE $${i} OR c.vehicle ILIKE $${i})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(`SELECT count(*)::int AS n FROM claims c ${w}`, params)).rows[0].n;
  const limitIdx = params.length + 1;
  const { rows } = await pool.query(
    `SELECT c.* FROM claims c ${w}
      ORDER BY ${SORTS[f.sort]} ${f.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, c.id DESC
      LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
    [...params, f.page_size, (f.page - 1) * f.page_size],
  );
  return { rows, total };
}

export async function countsBy(column) {
  if (!['stage', 'priority', 'status', 'incident_type', 'analysis_state'].includes(column)) throw new Error('bad column');
  const { rows } = await pool.query(`SELECT ${column} AS key, count(*)::int AS count FROM claims GROUP BY ${column}`);
  return Object.fromEntries(rows.map((r) => [r.key, r.count]));
}

/** Atomic compare-and-set on analysis_state; returns the updated row or null if the guard failed. */
export async function transitionAnalysis(id, { from, to, stage }, db = pool) {
  const { rows } = await db.query(
    `UPDATE claims SET analysis_state = $3, stage = COALESCE($4, stage), updated_at = now()
      WHERE id = $1 AND analysis_state = ANY($2::text[]) RETURNING *`,
    [id, from, to, stage ?? null],
  );
  return rows[0] ?? null;
}

export async function setFindings(id, { damage_summary, coverage_status, inconsistency_flag }, db = pool) {
  await db.query(
    `UPDATE claims SET damage_summary = $2, coverage_status = $3, inconsistency_flag = $4, updated_at = now()
      WHERE id = $1`,
    [id, damage_summary, coverage_status, inconsistency_flag],
  );
}

export async function setAnalysisStage(id, analysis_state, stage = null, db = pool) {
  await db.query(
    'UPDATE claims SET analysis_state = $2, stage = COALESCE($3, stage), updated_at = now() WHERE id = $1',
    [id, analysis_state, stage],
  );
}

export async function setStageOnly(id, stage, db = pool) {
  await db.query('UPDATE claims SET stage = $2, updated_at = now() WHERE id = $1', [id, stage]);
}
