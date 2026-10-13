# Deploying InsuraLens

```
Vercel (frontend) ──https──▶ Render: insuralens-api ──https + bearer token──▶ Render: insuralens-mcp
                                  │                                                 │
                                  ├──▶ Cloudinary  (uploaded photos/reports; only the API touches files)
                                  └──▶ Neon        (PostgreSQL) ◀───────────────────┘
```

| Piece | Where | Why |
|---|---|---|
| Frontend | Vercel (already deployed) | |
| API | Render web service | Express backend |
| `insuralens-mcp` | Render web service (second one) | The API calls it; it is the only writer of `claims.status` |
| PostgreSQL | Neon | Render's free Postgres expires; Neon's free tier doesn't |
| Uploaded files | Cloudinary | Render's disk is wiped on every deploy/restart |
| Docker Compose | Your laptop only | Local dev/demo. It is **not** how Render deploys |

**Order matters:** Neon → Cloudinary → secrets → migrate/seed → MCP → API → Vercel.

---

## 0. What you need

Accounts: **Neon**, **Cloudinary**, **Render**, your repo on **GitHub** (Render deploys from it), and **Vercel** (done).
Locally: Node 20+ (for the one-time migrate/seed commands). Never commit `.env`.

## 1. Neon (database)

1. Create a project (pick the region closest to your Render region).
2. Dashboard → **Connect** → copy the connection string:
   `postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require`
3. Use that **same string** for `DATABASE_URL` everywhere. If the app errors about `channel_binding`, delete `&channel_binding=require` from the string.
4. Neon scales to zero when idle: the first request after a quiet period is a little slower. That is expected; the code allows 15 s to connect.

## 2. Cloudinary (files)

1. Dashboard → **Settings → API Keys** → copy the **API environment variable**: `cloudinary://API_KEY:API_SECRET@CLOUD_NAME`. That is your `CLOUDINARY_URL`.
2. Free plan limits files to **10 MB**, so set `MAX_UPLOAD_MB=10`.
3. Files are uploaded as type `authenticated`: there is **no public URL**. The API signs a short-lived URL server-side and streams the bytes only to a logged-in user.
4. Verify credentials before deploying anything:
   ```bash
   STORAGE_DRIVER=cloudinary CLOUDINARY_URL='cloudinary://…' DATABASE_URL=x JWT_SECRET=0123456789abcdef MCP_GRAPH_TOKEN=xxxxxxxx MCP_REVIEW_TOKEN=yyyyyyyy npm run storage:check
   ```
   Expect `1/3 stored … 2/3 read back OK … 3/3 removed OK … Storage is ready.`

## 3. Generate three secrets

```bash
openssl rand -hex 32   # JWT_SECRET            (Render generates this one for you if you use render.yaml)
openssl rand -hex 32   # MCP_GRAPH_TOKEN
openssl rand -hex 32   # MCP_REVIEW_TOKEN
```
`MCP_GRAPH_TOKEN` and `MCP_REVIEW_TOKEN` must be **identical on both Render services**. Use two different values for the two tokens (that is what keeps the agent pipeline unable to reach `update_claim`).

## 4. Create the tables and demo data (once, from your laptop)

Create a local `.env` (git-ignored) with your **production** values:

```ini
DATABASE_URL=postgresql://…neon.tech/neondb?sslmode=require
JWT_SECRET=<any 16+ chars, only needed to start the scripts>
MCP_GRAPH_TOKEN=<token 1>
MCP_REVIEW_TOKEN=<token 2>
STORAGE_DRIVER=cloudinary
CLOUDINARY_URL=cloudinary://…
```
```bash
npm install
npm run migrate    # creates the tables
npm run seed       # demo claim CLM-1042 + sample claims; demo photos/report are uploaded to Cloudinary
```
`seed` is **demo data**. Skip it for a real production database (run only `migrate`; the API creates tables on boot anyway when `RUN_MIGRATIONS_ON_START=true`).

Policy documents (`data/policies/*.md`) are **baked into the Docker image**, not stored in Cloudinary. To change a policy: edit the file, redeploy, re-run `npm run seed`.

## 5. (Optional) Run it locally in Docker against Neon

```bash
# .env as above, but without STORAGE_DRIVER=cloudinary if you want files on local disk
docker compose -f docker-compose.neon.yml up --build
docker compose -f docker-compose.neon.yml run --rm backend npm run seed     # once, demo data only
```
API on `localhost:4000`, MCP on `localhost:5100`. The plain `docker-compose.yml` (with its own Postgres container) remains the fully offline option.

## 6. Render: the MCP service (deploy this first)

**New → Web Service** → pick the repo → **Language: Docker**.

| Setting | Value |
|---|---|
| Name | `insuralens-mcp` |
| Dockerfile path | `./Dockerfile` |
| **Docker command** | `node mcp_server/server.js` |
| Health check path | `/health` |

Environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon string |
| `MCP_GRAPH_TOKEN` | token 1 |
| `MCP_REVIEW_TOKEN` | token 2 |
| `DB_POOL_MAX` | `3` |

Leave `MCP_ADMIN_TOKEN` **unset** (it exists only for the MCP Inspector in development). Do **not** set `PORT`; Render provides it and the server reads it.

When it is live: `curl https://insuralens-mcp.onrender.com/health` → `{"status":"ok","service":"insuralens-mcp"}`. Note the URL; the API needs `<that URL>/mcp`.

## 7. Render: the API service

**New → Web Service** → same repo → **Docker**. No docker command (default starts the API).

| Setting | Value |
|---|---|
| Name | `insuralens-api` |
| Health check path | `/health` |

Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Neon string |
| `DB_POOL_MAX` | `5` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `MCP_URL` | `https://insuralens-mcp.onrender.com/mcp` |
| `MCP_GRAPH_TOKEN` | token 1 (same as MCP service) |
| `MCP_REVIEW_TOKEN` | token 2 (same as MCP service) |
| `CORS_ORIGINS` | `https://insura-lens.vercel.app` (comma-separate more; each origin must match exactly) |
| `STORAGE_DRIVER` | `cloudinary` |
| `CLOUDINARY_URL` | `cloudinary://…` |
| `MAX_UPLOAD_MB` | `10` |
| `RUN_MIGRATIONS_ON_START` | `true` |
| `AGENT_STEP_DELAY_MS` | `1200` (lets the UI timeline be visible; `0` for instant) |

**Shortcut:** `render.yaml` in the repo defines both services. **New → Blueprint** and Render will ask you for the `sync: false` values above. (I wrote it from Render's documented schema but could not run it here; if the Blueprint is rejected, use the manual steps.)

## 8. Vercel (frontend)

1. Set the frontend's API base URL environment variable to the API **origin**, e.g. `https://insuralens-api.onrender.com` (the frontend README names the variable; it was `VITE_API_BASE_URL`). It must be **https**: browsers block an https page from calling an http API.
2. Redeploy the frontend (Vite reads env vars at build time).
3. Vercel **preview** deployments have different URLs: add them to `CORS_ORIGINS` if you test on previews.

## 9. Verify (5 minutes)

```bash
API=https://insuralens-api.onrender.com
curl $API/health                                         # {"status":"ok",…}
open $API/api/docs                                       # Swagger UI
TOKEN=$(curl -s -X POST $API/api/auth/demo | jq -r .token)
curl -s -X POST $API/api/claims/CLM-1042/analyze -H "Authorization: Bearer $TOKEN"
sleep 8
curl -s $API/api/claims/CLM-1042 -H "Authorization: Bearer $TOKEN" | jq '.analysis.decision.recommendation'
# "request_more_information"
```
Then in the UI: upload a claim with photos, analyze, open a photo (it loads through the API from Cloudinary), review → status changes. Cloudinary's Media Library should show files under `insuralens/claims/<claim id>/`.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API logs `Invalid environment configuration` | A required variable is missing; the message names it. `STORAGE_DRIVER=cloudinary` requires `CLOUDINARY_URL`. |
| Analysis fails at the Policy step: `MCP call get_policy failed` | `MCP_URL` wrong (must end in `/mcp`), MCP service asleep or down, or the tokens differ between services (the MCP service returns 401). |
| Browser: CORS error | `CORS_ORIGINS` doesn't contain the exact frontend origin (scheme + host, no trailing slash). |
| `ECONNREFUSED` / SSL error to the database | Use the Neon string including `?sslmode=require`; for a channel-binding error remove `&channel_binding=require`. |
| Upload returns 413 | File larger than `MAX_UPLOAD_MB` (and Cloudinary free allows 10 MB max). |
| Photos don't load in the UI | The file URL needs a token: the frontend must request `/api/claims/:id/files/:fileId?token=<jwt>` for `<img>` tags (or fetch with the header). Check the API log for 404 from storage. |
| First request after idle takes ~30–60 s | Render free instances sleep after ~15 min idle (both services). Paid plan, or accept the cold start. |
| Claim stuck on "running" | Can't happen after a restart any more: on boot the API marks interrupted analyses `failed` so you can re-run them. |

## 11. Limits to know about

- **One API replica only.** Live-progress connections are held in memory (events are persisted, so a refresh still recovers). Don't scale the API horizontally without moving that to Redis or Postgres `LISTEN/NOTIFY`.
- **Analysis runs inside the API process.** A restart interrupts it; the claim becomes retryable on the next boot.
- **MCP is a public URL protected by bearer tokens.** Keep the tokens secret and long. On Render's paid plans you can make it a private service and use the internal address as `MCP_URL`.
- **Auth is demo-grade** (any email + the demo password). Set `ALLOW_DEMO_LOGIN=false` and replace `services/auth.service.js` before real users.
- **Render's free tier is for demos.** Cold starts, sleep, and a monthly hours cap.
