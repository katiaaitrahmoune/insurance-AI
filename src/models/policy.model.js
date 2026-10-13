import { pool } from '../config/db.js';
export const listPolicies = async () => (await pool.query('SELECT id, name, filename, coverage_summary FROM policies ORDER BY id')).rows;
export const getPolicyRow = async (id) => (await pool.query('SELECT id, name, filename, coverage_summary FROM policies WHERE id=$1', [id])).rows[0] ?? null;
