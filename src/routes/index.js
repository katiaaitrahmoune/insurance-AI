import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { claimUpload } from '../middleware/upload.js';
import { loginLimiter, analyzeLimiter } from '../middleware/rateLimit.js';
import * as auth from '../controllers/auth.controller.js';
import * as claims from '../controllers/claims.controller.js';
import * as misc from '../controllers/misc.controller.js';
import * as chatCtl from '../controllers/chat.controller.js';
import { loginBody } from '../validators/auth.validator.js';
import { createClaimBody, listClaimsQuery } from '../validators/claim.validator.js';
import { reviewBody } from '../validators/review.validator.js';
import { claimIdParam } from '../validators/common.js';
import { analyticsQuery } from '../validators/analytics.validator.js';
import { sendMessageBody, createConversationBody, conversationIdParam } from '../validators/chat.validator.js';
import { z } from 'zod';

export function buildRouter({ analysis, review, events, chat }) {
  const r = Router();
  const authed = requireAuth();
  const chatC = chatCtl.factory(chat);
  const withClaimId = validate({ params: claimIdParam });

  r.get('/health', misc.health);
  r.post('/auth/login', loginLimiter, validate({ body: loginBody }), auth.login);
  r.post('/auth/demo', loginLimiter, auth.demo);
  r.get('/auth/me', authed, auth.me);
  r.post('/auth/logout', authed, auth.logout);
  r.get('/claims', authed, validate({ query: listClaimsQuery }), claims.list);
  r.post('/claims',  claimUpload, validate({ body: createClaimBody }), claims.create);
  r.get('/claims/:id', authed, withClaimId, claims.get);
  r.post('/claims/:id/evidence', authed, withClaimId, claimUpload, claims.addEvidence);
  r.get('/claims/:id/files/:fileId', requireAuth({ allowQueryToken: true }), validate({ params: claimIdParam.extend({ fileId: z.string().uuid() }) }), claims.downloadFile);
  r.get('/claims/:id/related-cases', authed, withClaimId, misc.relatedCases);
r.get('/files', claims.listAllFilesHandler);
r.get('/files/:fileId/content',  validate({ params: z.object({ fileId: z.string().uuid() }), query: z.object({ format: z.enum(['base64', 'text']).default('base64') }) }), claims.fileContent);
r.get(
  '/files/:fileId/image',

  validate({
    params: z.object({
      fileId: z.string().uuid()
    })
  }),
  claims.getFileImage
);

r.patch('/claims/:id/analysis', authed, withClaimId, claims.updateAnalysis);
  
  r.post('/claims/:id/analyze', authed, analyzeLimiter, withClaimId, claims.analyzeFactory(analysis));
  r.get('/claims/:id/stream', requireAuth({ allowQueryToken: true }), withClaimId, claims.streamFactory(events));
  r.post('/claims/:id/review', authed, withClaimId, validate({ body: reviewBody }), claims.reviewFactory(review));
  r.get('/sources/:sourceId', authed, validate({ params: z.object({ sourceId: z.string().regex(/^[A-Za-z0-9_.:-]{3,120}$/) }) }), misc.source);
  r.get('/policies', authed, misc.policies);
  r.get('/dashboard/summary', authed, misc.dashboard);
  r.get('/analytics', authed, validate({ query: analyticsQuery }), misc.analytics);

  r.get('/notifications', authed, misc.listNotifications);
  r.post('/notifications/read-all', authed, misc.readAllNotifications);
  r.post('/notifications/:id/read', authed, validate({ params: z.object({ id: z.string().uuid() }) }), misc.readNotification);
  r.get('/chat/conversations', authed, chatCtl.listConversations);
  r.post('/chat/conversations', authed, validate({ body: createConversationBody }), chatCtl.createConversation);
  r.get('/chat/conversations/:id', authed, validate({ params: conversationIdParam }), chatC.get);
  r.post('/chat/conversations/:id/messages', authed, validate({ params: conversationIdParam, body: sendMessageBody }), chatC.send);
  r.post('/chat/messages', authed, validate({ body: sendMessageBody }), chatC.send);

  return r;
}
