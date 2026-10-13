// The one place that maps DB rows to API JSON. If the frontend's field names differ from these,
// this file (and docs/API_CONTRACT.md) are the only things to change.
export const serializeClaim = (c) => ({
  id: c.id,
  customerName: c.customer_name,
  vehicle: c.vehicle,
  status: c.status,
  stage: c.stage,
  priority: c.priority,
  incidentType: c.incident_type,
  estimatedAmount: c.estimated_amount,
  description: c.description,
  damageSummary: c.damage_summary,
  coverageStatus: c.coverage_status,
  inconsistencyFlag: c.inconsistency_flag,
  policyId: c.policy_id,
  analysisState: c.analysis_state,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
  decidedAt: c.decided_at,
});

export const serializeFile = (f) => ({
  id: f.id,
  claimId: f.claim_id,
  kind: f.kind,
  name: f.original_name,
  mimeType: f.mime_type,
  sizeBytes: f.size_bytes,
  url: `/api/claims/${f.claim_id}/files/${f.id}`,
  createdAt: f.created_at,
});

export const serializeAnalysis = (a) =>
  a && {
    id: a.id,
    state: a.state,
    vision: a.vision,
    policy: a.policy,
    decision: a.decision,
    events: (a.events ?? []).map((e, seq) => ({ ...e, seq })),
    humanDecision: a.human_decision,
    error: a.error,
    startedAt: a.started_at,
    completedAt: a.completed_at,
  };

export const serializeNotification = (n) => ({
  id: n.id, claimId: n.claim_id, title: n.title, body: n.body, read: n.read, createdAt: n.created_at,
});

export const serializeMessage = (m) => ({
  id: m.id, role: m.role, content: m.content, sources: m.sources, meta: m.meta, createdAt: m.created_at,
});

export const serializeConversation = (c) => ({
  id: c.id, claimId: c.claim_id, title: c.title, lastMessage: c.last_message ?? null,
  createdAt: c.created_at, updatedAt: c.updated_at,
});
