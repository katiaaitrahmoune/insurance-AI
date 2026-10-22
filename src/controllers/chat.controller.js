import * as chatModel from '../models/chat.model.js';
import { serializeConversation } from '../utils/serializers.js';
import { pool } from '../config/db.js';
import { notFound } from '../utils/errors.js';

export const listConversations = async (req, res) =>
  res.json({ items: (await chatModel.listConversations(req.user.id)).map(serializeConversation) });

export const createConversation = async (req, res) => {
  const { claim_id, title } = req.validated.body;
  res.status(201).json(serializeConversation(await chatModel.createConversation(req.user.id, claim_id, title)));
};

export const factory = (chat) => ({
  get: async (req, res) => res.json(await chat.getConversation(req.user, req.params.id)),
  send: async (req, res) => {
    const body = { ...req.validated.body };
    if (req.params.id) body.conversation_id = req.params.id;
    res.status(201).json(await chat.sendMessage(req.user, body));
  },
});



export const deleteConversation = async (req, res) => {
 
  const { rowCount } = await pool.query(
    `WITH owned AS (
       SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2
     ),
     del_messages AS (
       DELETE FROM chat_messages
        WHERE conversation_id IN (SELECT id FROM owned)
     )
     DELETE FROM chat_conversations
      WHERE id IN (SELECT id FROM owned)`,
    [req.params.id, req.user.id]
  );

  if (!rowCount) throw notFound('Conversation not found');
  res.status(204).end();
};