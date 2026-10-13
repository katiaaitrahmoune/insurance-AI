# InsuraLens Backend

Service layer for InsuraLens: **Express API**, **PostgreSQL**, the **`insuralens-mcp` server**, and the architectural human-in-the-loop guardrail.
*The AI analyzes and proposes. The human decides.*

Node.js 20+ · Express 5 · PostgreSQL 16 · MCP TypeScript SDK (Streamable HTTP) · Docker

## Quick start

```bash
cp .env.example .env            # set JWT_SECRET and the two MCP tokens
docker compose up --build       # postgres + mcp + (migrate & seed) + backend
```
API on `http://localhost:4000`, MCP on `http://localhost:5100/mcp`. Sign in with any email + `demo123`, or `POST /api/auth/demo`.

Without Docker: start Postgres, set `DATABASE_URL`, then
```bash
npm install
npm run migrate && npm run seed
npm run mcp        # terminal 1
npm start          # terminal 2   (npm run dev for watch mode)
```
Point the frontend at it: `VITE_API_BASE_URL=http://localhost:4000` (origin only). The API is documented in **Swagger UI at `http://localhost:4000/api/docs`** (spec: `docs/openapi.yaml`, plus the human-readable `docs/API_CONTRACT.md`).

## Deploying (Render + Neon + Cloudinary)

See **`docs/DEPLOYMENT.md`** for the complete step-by-step guide, env var tables, and troubleshooting. Short version: Postgres on **Neon**, files on **Cloudinary** (`STORAGE_DRIVER=cloudinary`), the API and `insuralens-mcp` as **two Render web services** (`render.yaml`), frontend on Vercel. `docker-compose.neon.yml` runs the containers locally against Neon.

## Structure

```
src/
  app.js, server.js, env.js     app factory (dependency-injected), bootstrap, validated env
  config/                       pg pool, logger, Swagger UI (docs.js)
  routes/ controllers/          thin HTTP layer
  middleware/                   auth, validation, upload, rate limit, error envelope
  validators/                   zod: request bodies AND the strict agent-output schemas (Seam 1)
  services/                     analysis, review (the gate), claims, events (SSE), chat, memory, MCP clients
    agents/                     AI Engineer plug-in point + deterministic fixture runner
  models/                       SQL + versioned migrations + seed
  knowledge/                    demo policy clauses, chat answers
  utils/                        constants, errors, serializers, deterministic date check
mcp_server/                     insuralens-mcp: server.js, tools/get_policy.js, tools/update_claim.js
scripts/                        migrate, seed, reset-demo, demo-view.sql
docs/                           openapi.yaml (source of truth), API_CONTRACT.md
data/                           policies/ claims/ images/  (demo evidence; policies/*.md are ingested)
tests/                          unit, MCP, guardrail tests
```

## How the guardrails are enforced (and tested)

| Guardrail | Enforcement | Test |
|---|---|---|
| No agent can call `update_claim` | The graph gets a client object with **only** `getPolicy`; it authenticates with a token whose MCP server instance **registers only `get_policy`** | `guardrails.test.js`, `mcp.test.js` |
| `update_claim` reachable only from review | Only `review.service.js` receives the review client; only `POST /claims/:id/review` calls it | analysis path → 0 calls; review → exactly 1; duplicate → 409 |
| `status` can't be changed any other way | **Postgres trigger** rejects a `status` change unless the transaction is the `update_claim` tool | direct `UPDATE` fails |
| Review can't be skipped or replayed | atomic `awaiting_review → reviewing` compare-and-set; double-clicks and out-of-order → `409` | yes |
| Every output is cited | strict zod schemas: verdict ≠ `unclear` requires a citation; unknown fields rejected; `/api/sources/:id` resolves every id | unit tests |
| Never says "fraud" | banned-term filter at the persistence boundary fails the analysis visibly | yes |
| Memory is supporting only | memory enters as `supporting_context`, never as an input to `recommendation` | recommendation identical with/without memory |

Every MCP call is written to `tool_call_log` (caller, arguments, result).

## Policy ingestion

`data/policies/*.md` are parsed section-aware (one chunk per `### ID: Title` clause, e.g. `COV-001`, `EXC-004`; policy id, insured, vehicle and effective dates come from the header). Drop in another policy file with the same layout and re-run `npm run seed`. `get_policy` serves the record; the clause text comes from the ingested document, never from model memory.

With `synthetic_motor_policy_v1.md` the fixture agents currently apply: **COV-001/002** (collision, struck by another vehicle), **POL-002** (policy period judged on the accident date, with the date conflict handled), **EXC-004** (commercial use → not covered), **EXC-001** (deliberate-act wording → `unclear` + mandatory human review, never an automatic denial), **POL-003** (claimant/vehicle vs. policy schedule), **CLM-002** (at least four photos), **EVD-002** (accident report). Not yet implemented: CLM-001 (14-day notice), LIM-001/002/003 (settlement math), PRE-001/003 (pre-existing damage, needs real image analysis), EXC-002 (misleading evidence), EVD-003 (itemized estimates), CLM-004 (30-day clarification timer). Those belong to the real Vision/Decision agents.

## Checkpoint 4: MCP Inspector

```bash
MCP_ADMIN_TOKEN=inspector-token-123 npm run mcp
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP · URL: http://localhost:5100/mcp · Header: Authorization: Bearer inspector-token-123
```
The admin token exists only for this; leave it unset in production.

## For the AI Engineer

`src/services/agents/index.js` is the seam. Implement `runAnalysis({claim, files, emit})`, `resume(...)`, `extractMemories(...)` and register a new `AGENT_MODE`. `emit(agent, status, payload)` is awaited and payloads are validated against the Seam 1 schemas before being stored or streamed. Today `AGENT_MODE=fixture` runs a deterministic stand-in: it reads the claim text and report, catches the date mismatch **in code**, and serves seeded policy clauses. It does **not** call Gemini or a vector store. If the graph stays in Python/LangGraph, expose it over HTTP and have the runner call it. The Backend contract does not change.

## Demo day

```bash
npm run reset-demo                                   # CLM-1042 back to PENDING (add -- --all to delete user-created claims)
psql "$DATABASE_URL" -f scripts/demo-view.sql        # status + MCP tool call + memory rows
npm test                                             # needs a Postgres test DB (TEST_DATABASE_URL)
```
Replace `data/images/CLM-1042_*.jpg` (placeholders) with the real photos and `data/claims/CLM-1042/accident_report.txt` with the PDF (`accident_report.pdf` is preferred if present), then `npm run seed`.

## Known limits

- Auth is demo-grade by design (the charter excludes advanced auth). Replace `services/auth.service.js`.
- SSE state is in-memory per process: run one backend replica (events are persisted, so refresh/recovery still works).
- Uploaded files go to local disk (`STORAGE_DRIVER=local`, dev) or Cloudinary (`cloudinary`, production, authenticated assets only).
- Markdown policies have no page numbers, so citations carry `page: null`.
- To start from a clean database after upgrading from an earlier build: `docker compose down -v` then `up --build`.
