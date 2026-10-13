import { z } from 'zod';
import { snakeKeys } from './common.js';

export const sendMessageBody = z.preprocess(
  snakeKeys,
  z.object({
    content: z.string().trim().min(1, 'content is required').max(4000),
    conversation_id: z.string().uuid().optional(),
    claim_id: z.string().regex(/^CLM-\d{3,10}$/).optional(),
  }),
);
export const createConversationBody = z.preprocess(
  snakeKeys,
  z.object({
    claim_id: z.string().regex(/^CLM-\d{3,10}$/).optional(),
    title: z.string().trim().max(120).optional(),
  }),
);
export const conversationIdParam = z.object({ id: z.string().uuid() });
