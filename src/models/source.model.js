import { pool } from '../config/db.js';

export async function upsertSource(db, s) {
  await db.query(
    `INSERT INTO sources (source_id, claim_id, kind, title, section, page, quote, file_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (source_id) DO UPDATE SET
       claim_id = EXCLUDED.claim_id, kind = EXCLUDED.kind, title = EXCLUDED.title, section = EXCLUDED.section,
       page = EXCLUDED.page, quote = EXCLUDED.quote, file_id = EXCLUDED.file_id, meta = EXCLUDED.meta`,
    [s.source_id, s.claim_id ?? null, s.kind, s.title, s.section ?? null, s.page ?? null, s.quote ?? null,
     s.file_id ?? null, JSON.stringify(s.meta ?? {})],
  );
}
export async function getSource(sourceId) {
  return (await pool.query('SELECT * FROM sources WHERE source_id = $1', [sourceId])).rows[0] ?? null;
}
