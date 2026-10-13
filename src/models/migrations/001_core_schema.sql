-- InsuraLens core schema. Charter tables: claims, policies, claim_memories.
-- Supporting tables (users, files, analyses, sources, audit, chat, notifications) are additive.

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'claims_officer',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE policies (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  filename          TEXT NOT NULL,
  coverage_summary  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE claim_number_seq START 1100;

CREATE TABLE claims (
  id                  TEXT PRIMARY KEY,
  customer_name       TEXT NOT NULL,
  vehicle             TEXT NOT NULL,
  -- GUARDED: only the update_claim MCP tool may change this column (see trigger below).
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','MORE_INFO_REQUIRED')),
  damage_summary      TEXT,
  coverage_status     TEXT CHECK (coverage_status IN ('covered','not_covered','partial','unclear')),
  inconsistency_flag  BOOLEAN NOT NULL DEFAULT false,
  policy_id           TEXT REFERENCES policies(id),
  description         TEXT NOT NULL DEFAULT '',
  stage               TEXT NOT NULL DEFAULT 'evidence_collection'
                      CHECK (stage IN ('intake','evidence_collection','ai_analysis','human_review','decided')),
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  incident_type       TEXT NOT NULL DEFAULT 'other',
  estimated_amount    NUMERIC(12,2),
  analysis_state      TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (analysis_state IN ('not_started','running','awaiting_review','reviewing','reviewed','failed')),
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ
);
CREATE INDEX idx_claims_stage ON claims(stage);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_created_at ON claims(created_at);

-- Guardrail 2 enforced in the database: status can change only inside a transaction that
-- declares itself as the update_claim tool (or the admin reset script). A stray UPDATE from
-- any other code path fails loudly instead of silently bypassing human review.
CREATE FUNCTION guard_claim_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.status_writer', true), '') NOT IN ('update_claim_tool', 'admin_reset') THEN
    RAISE EXCEPTION 'claims.status can only be changed through the update_claim MCP tool'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_claim_status
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION guard_claim_status();

CREATE TABLE claim_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image','report','policy','other')),
  original_name TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_claim_files_claim ON claim_files(claim_id);

CREATE TABLE claim_analyses (
  id              SERIAL PRIMARY KEY,
  claim_id        TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','awaiting_review','reviewed','failed')),
  vision          JSONB,
  policy          JSONB,
  decision        JSONB,
  events          JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_decision  JSONB,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_claim_analyses_claim ON claim_analyses(claim_id, id DESC);

CREATE TABLE claim_memories (
  id           SERIAL PRIMARY KEY,
  claim_id     TEXT NOT NULL,
  memory_type  TEXT NOT NULL CHECK (memory_type IN ('outcome','inconsistency','coverage')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_claim_memories_type ON claim_memories(memory_type);

-- Resolvable citations behind "View Source" (policy clause, report excerpt, image, statement).
CREATE TABLE sources (
  source_id  TEXT PRIMARY KEY,
  claim_id   TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('policy_clause','report_excerpt','claim_description','image')),
  title      TEXT NOT NULL,
  section    TEXT,
  page       INTEGER,
  quote      TEXT,
  file_id    UUID REFERENCES claim_files(id) ON DELETE SET NULL,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sources_claim ON sources(claim_id);

CREATE TABLE audit_log (
  id         SERIAL PRIMARY KEY,
  claim_id   TEXT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- Written by insuralens-mcp for every tool call (caller, arguments, result).
CREATE TABLE tool_call_log (
  id         SERIAL PRIMARY KEY,
  tool       TEXT NOT NULL,
  caller     TEXT NOT NULL,
  arguments  JSONB NOT NULL DEFAULT '{}'::jsonb,
  result     JSONB,
  ok         BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  claim_id   TEXT REFERENCES claims(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, created_at);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   TEXT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
