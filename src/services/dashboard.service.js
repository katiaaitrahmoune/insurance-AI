import { pool } from '../config/db.js';
import { countsBy } from '../models/claim.model.js';
import { recentAudit } from '../models/audit.model.js';
import { STAGES, PRIORITIES } from '../utils/constants.js';

const ACTION_TEXT = {
  claim_created: (id) => `Claim ${id} was created`,
  evidence_added: (id) => `Evidence was added to ${id}`,
  analysis_started: (id) => `AI analysis started for ${id}`,
  analysis_completed: (id) => `AI analysis finished for ${id}; awaiting officer review`,
  analysis_failed: (id) => `AI analysis could not complete for ${id}`,
  review_submitted: (id, d) => `Officer review submitted for ${id} (${d.action === 'approve' ? 'approved' : 'more information requested'})`,
};

export async function getDashboardSummary() {
  const [{ rows: [t] }, byStage, byPriority, audit] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE status <> 'APPROVED')::int AS open,
                       count(*) FILTER (WHERE stage = 'human_review')::int AS awaiting_review,
                       count(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
                       count(*) FILTER (WHERE status = 'MORE_INFO_REQUIRED')::int AS more_info_required,
                       count(*) FILTER (WHERE inconsistency_flag)::int AS with_inconsistencies,
                       count(*) FILTER (WHERE priority = 'high' AND status <> 'APPROVED')::int AS high_priority_open
                  FROM claims`),
    countsBy('stage'),
    countsBy('priority'),
    recentAudit(8),
  ]);
  return {
    totals: {
      claims: t.total, open: t.open, awaitingReview: t.awaiting_review, approved: t.approved,
      moreInfoRequired: t.more_info_required, withInconsistencies: t.with_inconsistencies, highPriorityOpen: t.high_priority_open,
    },
    byStage: STAGES.map((stage) => ({ stage, count: byStage[stage] ?? 0 })),
    byPriority: PRIORITIES.map((priority) => ({ priority, count: byPriority[priority] ?? 0 })),
    recentActivity: audit.map((a) => ({
      id: a.id, claimId: a.claim_id, actor: a.actor, action: a.action, createdAt: a.created_at,
      message: (ACTION_TEXT[a.action] ?? ((id) => `${a.action} on ${id}`))(a.claim_id, a.detail ?? {}),
    })),
  };
}
