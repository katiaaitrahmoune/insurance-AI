# InsuraLens API Contract

> **Interactive docs:** run the server and open **`/api/docs`** (Swagger UI). The machine-readable source of truth is **`docs/openapi.yaml`** (also served at `/api/openapi.json`); a test fails if a route is added without being documented. This file is the human-readable companion.

Base URL: `http://127.0.0.1:4000` · All app routes live under `/api` · JSON everywhere except uploads (multipart) and the progress stream (SSE).

**Auth:** `Authorization: Bearer <token>` on every route except `/health` and `/api/auth/login|demo`.
`EventSource` and `<img>` cannot send headers, so only two routes also accept `?token=<jwt>`: the stream and file download.

**Errors** always use one envelope:

```json
{ "error": { "code": "NOT_AWAITING_REVIEW", "message": "…", "details": [ { "field": "action", "message": "…" } ] } }
```

| Status | Meaning | Typical `code` |
|---|---|---|
| 400 | malformed JSON | `BAD_REQUEST` |
| 401 | missing/invalid token or bad login | `UNAUTHORIZED` |
| 404 | unknown route/claim/source/file | `NOT_FOUND` |
| 409 | state conflict (duplicate/out-of-order) | `NOT_AWAITING_REVIEW`, `ANALYSIS_NOT_STARTABLE`, `CLAIM_ALREADY_APPROVED`, `CLAIM_BUSY` |
| 413 | file too large | `FILE_TOO_LARGE` |
| 422 | validation failed (incl. unknown review action) | `VALIDATION_ERROR` |
| 429 | rate limited | `RATE_LIMITED` |
| 502 | `update_claim` MCP call failed (claim stays in review queue) | `MCP_TRANSPORT`, `MCP_INTERNAL` |

> **Naming:** claim resources are camelCase (`customerName`). The four charter "seams" (agent JSON, progress events, review payload, MCP tools) keep the charter's snake_case. Request bodies accept either casing. All DB→JSON mapping is in `src/utils/serializers.js`; if the frontend's types differ, change only that file.

## Vocabulary (tokens)

| Field | Values |
|---|---|
| `status` (**guarded**, only `update_claim` changes it) | `PENDING`, `APPROVED`, `MORE_INFO_REQUIRED` |
| `stage` | `intake`, `evidence_collection`, `ai_analysis`, `human_review`, `decided` |
| `priority` | `low`, `medium`, `high` |
| `incidentType` | `front_end_collision`, `rear_end_collision`, `side_impact`, `glass_damage`, `theft`, `other` |
| `analysisState` | `not_started`, `running`, `awaiting_review`, `reviewing`, `reviewed`, `failed` |
| `coverageStatus` | `covered`, `not_covered`, `partial`, `unclear` |

Stage/priority/incident tokens are an assumption (the frontend's `constants.ts` was not readable); edit `src/utils/constants.js` + the SQL `CHECK`s in one place if they differ.

## Auth

| Route | Body | Response |
|---|---|---|
| `POST /api/auth/login` | `{ email, password }` (any work email + demo password) | `{ token, user: { id, email, name, role } }` |
| `POST /api/auth/demo` | – | same as login ("Continue with demo") |
| `GET /api/auth/me` | – | `{ user }` |
| `POST /api/auth/logout` | – | `204` (stateless; discard the token) |

## Claims

### `GET /api/claims`
Query: `q`, `tab`/`stage`, `priority`, `status`, `incidentType`, `sort` (`created_at|updated_at|priority|amount`), `order`, `page` (1), `pageSize` (25, max 100).
```json
{ "items": [Claim], "page": 1, "pageSize": 25, "total": 26, "totalPages": 2,
  "counts": { "all": 26, "intake": 5, "evidence_collection": 11, "human_review": 1, "decided": 9 } }
```
`counts` ignores the filters (use it for tab badges).

### `POST /api/claims` — create (multipart/form-data)
Text: `customerName`*, `vehicle`*, `description`, `policyId` (default `AT-MOT-2026-X99`), `priority`, `incidentType`, `estimatedAmount`.
Files: `images` (≤6, JPEG/PNG/WebP), `report` (PDF/TXT), `policy` (PDF). Real file type is verified by magic bytes. → `201` `Claim & { files: File[] }`

### `POST /api/claims/:id/evidence` — add files (same file fields) → `201 { files: File[] }` (`409 CLAIM_BUSY` while analysis/review runs)

### `GET /api/claims/:id`
`Claim & { files: File[], analysis: Analysis | null }`

```jsonc
// Claim
{ "id": "CLM-1042", "customerName": "John Doe", "vehicle": "2024 Fictional Motors Sedan", "status": "PENDING",
  "stage": "human_review", "priority": "high", "incidentType": "front_end_collision", "estimatedAmount": 4800,
  "description": "…", "damageSummary": "front bumper, left headlight", "coverageStatus": "covered",
  "inconsistencyFlag": true, "policyId": "AT-MOT-2026-X99", "analysisState": "awaiting_review",
  "createdAt": "…", "updatedAt": "…", "decidedAt": null }
// File
{ "id": "uuid", "claimId": "CLM-1042", "kind": "image|report|policy|other", "name": "…", "mimeType": "image/jpeg", "sizeBytes": 123, "url": "/api/claims/CLM-1042/files/<id>" }
// Analysis (latest run) — use this to recover after a page refresh
{ "id": 3, "state": "running|awaiting_review|reviewed|failed", "vision": VisionOutput|null, "policy": PolicyOutput|null,
  "decision": DecisionOutput|null, "events": [Event], "humanDecision": {…}|null, "error": null, "startedAt": "…", "completedAt": "…" }
```

### `GET /api/claims/:id/files/:fileId` — streams the stored file (`?token=` allowed, for `<img>`/PDF viewers)
### `GET /api/claims/:id/related-cases` — long-term-memory hits from other claims (supporting context only)

## Agent pipeline

### `POST /api/claims/:id/analyze` → `202 { claim_id, analysis_id, state: "running" }`
Returns immediately. **Never** changes `status`. `409` if already running/awaiting review/approved. Allowed again after `failed` or `reviewed` (re-analysis after "request more information").

### `GET /api/claims/:id/stream` — Server-Sent Events (`?token=`)
Replays the latest run, then streams live. Each frame: `id: <analysis_id>-<seq>`, `event: <event name>`, `data: <json>`. Heartbeat comment every 15 s; `EventSource` auto-reconnect + `Last-Event-ID` resumes mid-run. When `analysis_id` changes, reset the timeline.

```jsonc
{ "claim_id": "CLM-1042", "analysis_id": 3, "seq": 0, "ts": "…", "event": "analysis_started" }
{ "claim_id": "CLM-1042", "analysis_id": 3, "seq": 2, "event": "agent_status",
  "agent": "vision|policy|decision", "status": "running|completed|flagged|failed",
  "payload": VisionOutput | PolicyOutput | DecisionOutput | { "error": { "code", "message" } } | null }
{ "claim_id": "CLM-1042", "analysis_id": 3, "seq": 7, "event": "awaiting_review", "recommendation": "request_more_information" }
{ "claim_id": "CLM-1042", "analysis_id": 3, "seq": 4, "event": "analysis_failed", "agent": "policy", "message": "…" }
```
`flagged` = completed with something the officer should look at (low-confidence damage, coverage not "covered", inconsistencies).

## Agent output schemas (Seam 1 — strict, validated server-side)

```jsonc
// VisionOutput
{ "damages": [ { "part": "front bumper", "description": "visible damage", "confidence": 0.91,
                 "image_ref": "<file id>", "source_id": "src_img_CLM-1042_front_bumper", "needs_verification": true /* only if low confidence */ } ] }
// PolicyOutput — a verdict other than "unclear" must carry ≥1 citation
{ "coverage_verdict": "covered|not_covered|partial|unclear",
  "citations": [ { "policy_id": "AT-MOT-2026-X99", "policy_name": "…", "section": "COV-001", "clause_quote": "<verbatim clause text>", "page": null, "source_id": "src_pol_AT-MOT-2026-X99_COV-001" } ],
  "reasoning": "…", "unmatched_damage": [] }
// DecisionOutput — `recommendation`, never `decision`
{ "summary": "…", "coverage": "covered",
  "inconsistencies": [ { "type": "date_mismatch", "severity": "high", "description": "Dates differ between customer statement and official report.",
      "evidence": [ { "source": "claim_description", "value": "March 12, 2026", "source_id": "src_desc_CLM-1042", "excerpt": "…" },
                    { "source": "accident_report",   "value": "March 15, 2026", "source_id": "src_rpt_CLM-1042",  "excerpt": "…" } ] } ],
  "missing_information": [], "recommendation": "approve|request_more_information",
  "supporting_context": { "related_past_cases": [ { "claim_id": "CLM-1042", "memory_type": "inconsistency", "content": "Accident date mismatch" } ] } }
```
Outputs containing accusatory wording are rejected and the analysis fails visibly.

## Human review (Seam 4) — the only route that reaches `update_claim`

`POST /api/claims/:id/review`
```json
{ "claim_id": "CLM-1042", "action": "approve | request_info" }
```
`claim_id` optional (must match URL). `approve → APPROVED`, `request_info → MORE_INFO_REQUIRED`.
```json
200 { "claim_id": "CLM-1042", "old_status": "PENDING", "new_status": "MORE_INFO_REQUIRED", "tool_call": "update_claim",
      "tool_result": { "claim_id": "…", "old_status": "…", "new_status": "…", "updated_at": "…" }, "memory_saved": true }
```
`409 NOT_AWAITING_REVIEW` if analysis hasn't finished or it was already reviewed · `422` unknown action · `502` tool failed (claim stays reviewable; retry is safe).
UI copy for the result: `update_claim(CLM-1042, MORE_INFO_REQUIRED) succeeded`.

## Evidence viewer

`GET /api/sources/:sourceId` →
```json
{ "source_id": "src_pol_AT-MOT-2026-X99_COV-001", "kind": "policy_clause|report_excerpt|claim_description|image", "title": "Accidental Collision Damage (COV-001)",
  "section": "COV-001", "page": null, "quote": "<verbatim text>", "claim_id": null, "meta": {},
  "file": { "id": "…", "name": "…", "mime_type": "…", "url": "/api/claims/…/files/…" } | null }
```
Every `source_id` in an analysis resolves here. Policy citations use the clause id as `section` (`COV-001`, `EXC-004`, …); `page` is `null` for Markdown policies.

## Other screens

| Route | Response |
|---|---|
| `GET /api/dashboard/summary` | `{ totals: { claims, open, awaitingReview, approved, moreInfoRequired, withInconsistencies, highPriorityOpen }, byStage: [{stage,count}], byPriority: [...], recentActivity: [{ id, claimId, actor, action, message, createdAt }] }` |
| `GET /api/analytics?from=&to=&incidentType=&priority=` | `{ filters, summary: { totalClaims, approved, awaitingReview, inconsistencyRate, avgHoursToDecision, avgAnalysisSeconds }, claimsPerDay: [{date,count}], byIncidentType, byStage, byStatus }` |
| `GET /api/policies` | `{ items: [{ id, name, filename, coverage_summary }] }` |
| `GET /api/notifications` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all` | `{ items: [{ id, claimId, title, body, read, createdAt }], unreadCount }` |
| `GET /health` | `{ status: "ok" }` |

## Chat

| Route | Notes |
|---|---|
| `POST /api/chat/messages` | `{ content, conversationId?, claimId? }` → `201 { conversationId, messages: [userMsg, assistantMsg] }`. "Analyze CLM-1042" starts the same analysis as the REST route (`assistantMsg.meta.action = "analysis_started"`). Chat can explain findings (with `sources`) but **cannot** change status. |
| `POST /api/chat/conversations/:id/messages` | same, for an existing conversation |
| `GET /api/chat/conversations` · `POST /api/chat/conversations` · `GET /api/chat/conversations/:id` | list / create / get with messages |

## MCP tool signatures (Seam 3, `insuralens-mcp`, Streamable HTTP at `/mcp`)

```
get_policy(policy_id: str)            -> { id, name, filename, coverage_summary }
update_claim(claim_id: str, status: str) -> { claim_id, old_status, new_status, updated_at }
status ∈ PENDING | APPROVED | MORE_INFO_REQUIRED      errors: NOT_FOUND, INVALID_STATUS
```
