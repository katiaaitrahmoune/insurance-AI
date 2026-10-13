import { pool } from '../config/db.js';
export async function upsertUser(email, name) {
  return (await pool.query(
    `INSERT INTO users (email, name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING *`, [email, name])).rows[0];
}
export const getUser = async (id) => (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0] ?? null;
