import { pool } from '../config/db.js';

export async function createConversation(userId, claimId, title) {
  return (await pool.query(
    'INSERT INTO chat_conversations (user_id, claim_id, title) VALUES ($1,$2,$3) RETURNING *',
    [userId, claimId ?? null, title || 'New conversation'])).rows[0];
}
export async function getConversation(id, userId) {
  return (await pool.query('SELECT * FROM chat_conversations WHERE id=$1 AND user_id=$2', [id, userId])).rows[0] ?? null;
}
export async function listConversations(userId) {
  return (await pool.query(
    `SELECT c.*, (SELECT content FROM chat_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
       FROM chat_conversations c WHERE c.user_id=$1 ORDER BY c.updated_at DESC`, [userId])).rows;
}
export async function addMessage(conversationId, role, content, sources = [], meta = {}) {
  const row = (await pool.query(
    'INSERT INTO chat_messages (conversation_id, role, content, sources, meta) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [conversationId, role, content, JSON.stringify(sources), JSON.stringify(meta)])).rows[0];
  await pool.query('UPDATE chat_conversations SET updated_at = now() WHERE id=$1', [conversationId]);
  return row;
}
export async function listMessages(conversationId) {
  return (await pool.query('SELECT * FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at, id', [conversationId])).rows;
}
export async function setTitle(id, title) {
  await pool.query('UPDATE chat_conversations SET title=$2 WHERE id=$1', [id, title]);
}
