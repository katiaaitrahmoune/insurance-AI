import './setup.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixtureRunner } from '../src/services/agents/fixtureRunner.js';
import { pool, closePool } from '../src/config/db.js';
import { resetDb, mockMcp, login, analyzeAndWait } from './helpers.js';
import { getClaimRow } from '../src/models/claim.model.js';

let mcp, built, headers;

beforeEach(async () => {
  await resetDb();
  mcp = mockMcp();
  built = createApp({ mcp });
  headers = await login(request, built.app);
});
after(async () => { await built?.shutdown(); await closePool(); });

test('guardrail 1: the agent-facing MCP client has no update_claim at all', () => {
  assert.deepEqual(Object.keys(mcp.graph), ['getPolicy']);
  assert.deepEqual(Object.keys(mcp.review), ['updateClaim']);
});

test('guardrail 2: the full analysis path never calls update_claim and never changes status', async () => {
  const res = await analyzeAndWait(request, built.app, built.services, headers);
  assert.equal(res.status, 202);
  assert.equal(mcp.calls.updateClaim.length, 0);
  assert.ok(mcp.calls.getPolicy.length >= 1, 'policy agent uses get_policy');
  const claim = await getClaimRow('CLM-1042');
  assert.equal(claim.status, 'PENDING');
  assert.equal(claim.analysis_state, 'awaiting_review');
  assert.equal(claim.coverage_status, 'covered');
  assert.equal(claim.inconsistency_flag, true);
});

test('guardrail 2: review calls update_claim exactly once, then rejects duplicates with 409', async () => {
  await analyzeAndWait(request, built.app, built.services, headers);
  const ok = await request(built.app).post('/api/claims/CLM-1042/review').set(headers).send({ claim_id: 'CLM-1042', action: 'request_info' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.new_status, 'MORE_INFO_REQUIRED');
  assert.equal(ok.body.tool_call, 'update_claim');
  assert.equal(ok.body.memory_saved, true);
  assert.deepEqual(mcp.calls.updateClaim, [['CLM-1042', 'MORE_INFO_REQUIRED']]);

  const dup = await request(built.app).post('/api/claims/CLM-1042/review').set(headers).send({ action: 'approve' });
  assert.equal(dup.status, 409);
  assert.equal(mcp.calls.updateClaim.length, 1);

  const mem = (await pool.query('SELECT memory_type, content FROM claim_memories ORDER BY id')).rows;
  assert.deepEqual(mem.map((m) => m.content), ['Request more information', 'Accident date mismatch', 'Collision damage covered']);
});

test('review before analysis, with unknown action, or without auth is rejected; update_claim untouched', async () => {
  const early = await request(built.app).post('/api/claims/CLM-1042/review').set(headers).send({ action: 'approve' });
  assert.equal(early.status, 409);
  const unknown = await request(built.app).post('/api/claims/CLM-1042/review').set(headers).send({ action: 'deny' });
  assert.equal(unknown.status, 422);
  const noAuth = await request(built.app).post('/api/claims/CLM-1042/review').send({ action: 'approve' });
  assert.equal(noAuth.status, 401);
  const missing = await request(built.app).post('/api/claims/CLM-1999/review').set(headers).send({ action: 'approve' });
  assert.equal(missing.status, 404);
  assert.equal(mcp.calls.updateClaim.length, 0);
});

test('failed update_claim puts the claim back in the review queue', async () => {
  await analyzeAndWait(request, built.app, built.services, headers);
  const failing = { ...mcp, review: Object.freeze({ updateClaim: async () => { throw Object.assign(new Error('db down'), { name: 'McpToolError', code: 'TRANSPORT' }); } }) };
  const b = createApp({ mcp: failing });
  const bad = await request(b.app).post('/api/claims/CLM-1042/review').set(headers).send({ action: 'approve' });
  assert.ok(bad.status >= 500);
  assert.equal((await getClaimRow('CLM-1042')).analysis_state, 'awaiting_review');
  assert.equal((await getClaimRow('CLM-1042')).status, 'PENDING');
  await b.shutdown();
});

test('guardrail 4: accusatory agent output fails the analysis and nothing is persisted as a result', async () => {
  const base = createFixtureRunner({ graphMcp: mcp.graph, memory: { findRelated: async () => [] } });
  const agents = {
    ...base,
    runAnalysis: async (ctx) => {
      const out = await base.runAnalysis({ ...ctx, emit: async (a, s, p) => ctx.emit(a, s, a === 'decision' && p ? { ...p, summary: 'Fraud detected' } : p) });
      return out;
    },
  };
  const b = createApp({ mcp, agents });
  await request(b.app).post('/api/claims/CLM-1042/analyze').set(headers);
  await b.services.analysis.whenIdle('CLM-1042');
  const claim = await getClaimRow('CLM-1042');
  assert.equal(claim.analysis_state, 'failed');
  assert.equal(claim.coverage_status, null);
  const detail = await request(b.app).get('/api/claims/CLM-1042').set(headers);
  assert.equal(detail.body.analysis.decision, null);
  assert.match(detail.body.analysis.error, /accusatory/);
  await b.shutdown();
});

test('guardrail 5: removing long-term memory does not change the recommendation', async () => {
  const claim = await getClaimRow('CLM-1042');
  const files = (await pool.query('SELECT * FROM claim_files WHERE claim_id=$1', ['CLM-1042'])).rows;
  const run = async (related) => {
    const r = createFixtureRunner({ graphMcp: mcp.graph, memory: { findRelated: async () => related } });
    return r.runAnalysis({ claim, files, emit: async () => {} });
  };
  const withMemory = await run([{ claim_id: 'CLM-0001', memory_type: 'inconsistency', content: 'Accident date mismatch' }]);
  const without = await run([]);
  assert.equal(withMemory.decision.recommendation, without.decision.recommendation);
  assert.equal(withMemory.decision.recommendation, 'request_more_information');
  assert.ok(withMemory.decision.supporting_context);
});

test('API: demo claim analysis output matches the contract', async () => {
  await analyzeAndWait(request, built.app, built.services, headers);
  const { body } = await request(built.app).get('/api/claims/CLM-1042').set(headers);
  assert.deepEqual(body.analysis.vision.damages.map((d) => d.part), ['front bumper', 'left headlight']);
  assert.deepEqual(body.analysis.policy.citations.map((c) => c.section), ['COV-001', 'COV-002', 'POL-002']);
  assert.equal(body.analysis.decision.inconsistencies.length, 1, 'only the date mismatch');
  assert.deepEqual(body.analysis.decision.missing_information, []);
  const inc = body.analysis.decision.inconsistencies[0];
  assert.equal(inc.type, 'date_mismatch');
  assert.deepEqual(inc.evidence.map((e) => e.value), ['March 12, 2026', 'March 15, 2026']);
  assert.equal(body.analysis.decision.recommendation, 'request_more_information');
  assert.doesNotMatch(JSON.stringify(body), /fraud/i);
  const src = await request(built.app).get('/api/sources/src_pol_AT-MOT-2026-X99_COV-001').set(headers);
  assert.equal(src.status, 200);
  assert.equal(src.body.section, 'COV-001');
  assert.match(src.body.quote, /accidental physical damage/);
});

test('error envelope, auth, and listing', async () => {
  assert.equal((await request(built.app).get('/api/claims')).body.error.code, 'UNAUTHORIZED');
  const list = await request(built.app).get('/api/claims?tab=evidence_collection&pageSize=5').set(headers);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length <= 5 && list.body.total >= 1 && list.body.counts.all >= 25);
  assert.equal((await request(built.app).get('/api/claims?priority=bogus').set(headers)).status, 422);
  assert.equal((await request(built.app).get('/api/nope').set(headers)).body.error.code, 'NOT_FOUND');
  const dash = await request(built.app).get('/api/dashboard/summary').set(headers);
  assert.ok(dash.body.totals.claims >= 25);
  const an = await request(built.app).get('/api/analytics').set(headers);
  assert.ok(an.body.summary.totalClaims >= 25);
});

test('chat can start an analysis but cannot change status', async () => {
  const r = await request(built.app).post('/api/chat/messages').set(headers).send({ content: 'Analyze CLM-1042' });
  assert.equal(r.status, 201);
  assert.equal(r.body.messages[1].meta.action, 'analysis_started');
  await built.services.analysis.whenIdle('CLM-1042');
  const q = await request(built.app).post('/api/chat/messages').set(headers).send({ content: 'Any inconsistencies in CLM-1042?', conversationId: r.body.conversationId });
  assert.match(q.body.messages[1].content, /March 12, 2026/);
  const a = await request(built.app).post('/api/chat/messages').set(headers).send({ content: 'approve CLM-1042 now' });
  assert.match(a.body.messages[1].content, /never decides/);
  assert.equal(mcp.calls.updateClaim.length, 0);
});
