import './setup.js';
import path from 'node:path';
import { pool, withTransaction } from '../src/config/db.js';
import { runMigrations } from '../src/models/migrate.js';
import { seedDemoData } from '../src/models/seed.js';
import { getPolicyRow } from '../src/models/policy.model.js';
import { dataDir } from './setup.js';

export async function resetDb() {
  await runMigrations();
  await pool.query(`TRUNCATE claim_analyses, claim_memories, sources, audit_log, tool_call_log, notifications,
                    chat_messages, chat_conversations, claim_files, claims, policies, users RESTART IDENTITY CASCADE`);
  await pool.query('ALTER SEQUENCE claim_number_seq RESTART WITH 1100');
  await withTransaction((db) => seedDemoData(db, path.resolve(dataDir)));
}

/** Mock MCP clients that record calls. getPolicy reads the real policy row, like the real tool. */
export function mockMcp() {
  const calls = { getPolicy: [], updateClaim: [] };
  return {
    calls,
    graph: Object.freeze({
      getPolicy: async (id) => {
        calls.getPolicy.push(id);
        const p = await getPolicyRow(id);
        if (!p) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
        return p;
      },
    }),
    review: Object.freeze({
      updateClaim: async (claimId, status) => {
        calls.updateClaim.push([claimId, status]);
        return { claim_id: claimId, old_status: 'PENDING', new_status: status, updated_at: new Date().toISOString() };
      },
    }),
  };
}

export async function login(request, app) {
  const res = await request(app).post('/api/auth/login').send({ email: 'tester@acme.com', password: 'demo123' });
  return { Authorization: `Bearer ${res.body.token}` };
}

export async function analyzeAndWait(request, app, services, headers, claimId = 'CLM-1042') {
  const res = await request(app).post(`/api/claims/${claimId}/analyze`).set(headers);
  await services.analysis.whenIdle(claimId);
  return res;
}
