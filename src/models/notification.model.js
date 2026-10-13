import { pool } from '../config/db.js';
export async function createNotification(claimId, title, body = '') {
  await pool.query('INSERT INTO notifications (claim_id, title, body) VALUES ($1,$2,$3)', [claimId, title, body]);
}
export const listNotifications = async (limit = 30) =>
  (await pool.query('SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT $1', [limit])).rows;
export async function markRead(id) {
  return (await pool.query('UPDATE notifications SET read = true WHERE id = $1 RETURNING *', [id])).rows[0] ?? null;
}
export const markAllRead = async () => (await pool.query('UPDATE notifications SET read = true WHERE read = false')).rowCount;
