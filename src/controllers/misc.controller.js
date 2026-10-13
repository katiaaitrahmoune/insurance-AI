import { resolveSource } from '../services/source.service.js';
import { getDashboardSummary } from '../services/dashboard.service.js';
import { getAnalytics } from '../services/analytics.service.js';
import { listPolicies } from '../models/policy.model.js';
import { findRelated } from '../models/memory.model.js';
import * as notifications from '../models/notification.model.js';
import { serializeNotification } from '../utils/serializers.js';
import { notFound } from '../utils/errors.js';
import { pool } from '../config/db.js';

export const source = async (req, res) => res.json(await resolveSource(req.params.sourceId));
export const dashboard = async (_req, res) => res.json(await getDashboardSummary());
export const analytics = async (req, res) => res.json(await getAnalytics(req.validated.query));
export const policies = async (_req, res) => res.json({ items: await listPolicies() });
export const relatedCases = async (req, res) => {
  const rows = await findRelated({ types: ['inconsistency', 'coverage', 'outcome'], excludeClaimId: req.params.id, limit: 10 });
  res.json({ items: rows.map((r) => ({ claimId: r.claim_id, memoryType: r.memory_type, content: r.content, createdAt: r.created_at })) });
};

export const listNotifications = async (_req, res) => {
  const rows = await notifications.listNotifications();
  res.json({ items: rows.map(serializeNotification), unreadCount: rows.filter((n) => !n.read).length });
};
export const readNotification = async (req, res) => {
  const n = await notifications.markRead(req.params.id);
  if (!n) throw notFound('Notification not found');
  res.json(serializeNotification(n));
};
export const readAllNotifications = async (_req, res) => res.json({ updated: await notifications.markAllRead() });

export const health = async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'insuralens-backend' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'insuralens-backend', database: 'unreachable' });
  }
};
