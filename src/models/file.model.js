import { pool } from '../config/db.js';

export async function insertFile(db, f) {
  const { rows } = await db.query(
       `INSERT INTO claim_files (claim_id, kind, original_name, stored_path, mime_type, size_bytes, storage, public_id, resource_type, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [f.claim_id, f.kind, f.original_name, f.stored_path ?? null, f.mime_type, f.size_bytes,
     f.storage ?? 'local', f.public_id ?? null, f.resource_type ?? null, f.is_public ?? false],
  );
  return rows[0];
}
export async function listFiles(claimId, db = pool) {
  return (await db.query('SELECT * FROM claim_files WHERE claim_id = $1 ORDER BY created_at, id', [claimId])).rows;
}
export async function getFile(id) {
  return (await pool.query('SELECT * FROM claim_files WHERE id = $1', [id])).rows[0] ?? null;
}

export async function listEveryFile() {
  return (await pool.query('SELECT * FROM claim_files ORDER BY created_at DESC, id')).rows;
}