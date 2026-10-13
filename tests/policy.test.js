import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFixtureRunner } from '../src/services/agents/fixtureRunner.js';
import { parsePolicyMarkdown, getPolicyDoc } from '../src/knowledge/policies.js';
import { validateAgentPayload } from '../src/validators/agentOutput.validator.js';

const POLICY = 'AT-MOT-2026-X99';
const graphMcp = { getPolicy: async (id) => ({ id, name: 'Test policy', filename: 'x.md', coverage_summary: '' }) };
const runner = createFixtureRunner({ graphMcp, memory: { findRelated: async () => [] } });

function report(text) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-')), 'report.txt');
  fs.writeFileSync(f, text);
  return { id: randomUUID(), kind: 'report', stored_path: f, mime_type: 'text/plain' };
}
const photos = (n) => Array.from({ length: n }, () => ({ id: randomUUID(), kind: 'image' }));
const claim = (over = {}) => ({
  id: 'CLM-T1', customer_name: 'John Doe', vehicle: '2024 Fictional Motors Sedan', policy_id: POLICY,
  incident_type: 'front_end_collision', description: 'The accident happened on March 15, 2026. Another vehicle hit the front of my car.', ...over,
});
const run = async (c, files) => runner.runAnalysis({ claim: c, files, emit: async () => {} });
const okReport = () => report('The accident occurred on March 15, 2026. Vehicle 2 struck the front of Vehicle 1.');

test('ingest: all 42 clauses parsed with ids, groups and metadata', async () => {
  const doc = await getPolicyDoc(POLICY);
  assert.equal(doc.clauses.length, 42);
  assert.equal(doc.insured, 'John Doe');
  assert.equal(doc.vehicle, '2024 Fictional Motors Sedan');
  assert.deepEqual([doc.effective_from, doc.effective_to], ['2026-01-01', '2026-12-31']);
  const pol002 = doc.clauses.find((c) => c.id === 'POL-002');
  assert.match(pol002.text, /^Coverage is active strictly/); // duplicated heading line removed
  assert.equal(doc.clauses.find((c) => c.id === 'COV-001').source_id, `src_pol_${POLICY}_COV-001`);
  assert.equal(parsePolicyMarkdown('no metadata here', 'x.md'), null);
});

test('clean claim: covered by COV-001/COV-002 within the policy period; quotes are verbatim policy text', async () => {
  const out = await run(claim(), [...photos(4), okReport()]);
  assert.equal(out.policy.coverage_verdict, 'covered');
  assert.deepEqual(out.policy.citations.map((c) => c.section), ['COV-001', 'COV-002', 'POL-002']);
  const doc = await getPolicyDoc(POLICY);
  for (const c of out.policy.citations) assert.equal(c.clause_quote, doc.clauses.find((x) => x.id === c.section).text);
  assert.equal(out.decision.recommendation, 'approve');
  assert.deepEqual(out.decision.inconsistencies, []);
});

test('POL-002: accident outside the policy period is not covered, judged on accident date', async () => {
  const c = claim({ description: 'The accident happened on March 15, 2025.' });
  const out = await run(c, [...photos(4), report('The accident occurred on March 15, 2025.')]);
  assert.equal(out.policy.coverage_verdict, 'not_covered');
  assert.equal(out.policy.citations[0].section, 'POL-002');
  assert.equal(out.decision.recommendation, 'request_more_information');
});

test('POL-002: one date in the period and one outside -> unclear, never a guess', async () => {
  const c = claim({ description: 'The accident happened on December 30, 2025.' });
  const out = await run(c, [...photos(4), report('The accident occurred on January 2, 2026.')]);
  assert.equal(out.policy.coverage_verdict, 'unclear');
});

test('EXC-004: commercial use is excluded; EXC-001: deliberate wording is flagged, NOT denied', async () => {
  const commercial = await run(claim({ description: 'The accident happened on March 15, 2026 while I was on a delivery shift.' }), [...photos(4), okReport()]);
  assert.equal(commercial.policy.coverage_verdict, 'not_covered');
  assert.equal(commercial.policy.citations[0].section, 'EXC-004');

  const intentional = await run(claim({ description: 'The accident happened on March 15, 2026. I hit the post on purpose.' }), [...photos(4), okReport()]);
  assert.equal(intentional.policy.coverage_verdict, 'unclear', 'EXC-001 must never auto-deny');
  assert.equal(intentional.policy.citations[0].section, 'EXC-001');
  assert.ok(intentional.decision.missing_information.some((m) => /EXC-001/.test(m)));
  assert.equal(intentional.decision.recommendation, 'request_more_information');
});

test('POL-003: claimant or vehicle differing from the policy schedule is surfaced with the clause as evidence', async () => {
  const out = await run(claim({ customer_name: 'Jane Smith' }), [...photos(4), okReport()]);
  const inc = out.decision.inconsistencies.find((i) => i.description.includes('POL-003'));
  assert.ok(inc);
  assert.deepEqual(inc.evidence.map((e) => e.source), ['claim_record', 'policy_schedule']);
  assert.equal(inc.evidence[1].source_id, `src_pol_${POLICY}_POL-003`);
  assert.equal(out.decision.recommendation, 'request_more_information');
});

test('CLM-002: fewer than four photos is listed as missing information', async () => {
  const out = await run(claim(), [...photos(3), okReport()]);
  assert.ok(out.decision.missing_information.some((m) => /four clear photographs; 3 provided/.test(m)));
  assert.equal(out.decision.recommendation, 'request_more_information');
});

test('EVD-002: no accident report -> missing_document, human follow-up', async () => {
  const out = await run(claim(), photos(4));
  assert.ok(out.decision.inconsistencies.some((i) => i.type === 'missing_document'));
});

test('collision-only policy: non-collision damage is unmatched, never assumed covered', async () => {
  const out = await run(claim({ incident_type: 'glass_damage' }), [...photos(4), okReport()]);
  assert.equal(out.policy.coverage_verdict, 'unclear');
  assert.deepEqual(out.policy.unmatched_damage, ['windshield']);
});

test('policy with no ingested clauses -> honest "unclear" with no citations', async () => {
  const out = await run(claim({ policy_id: 'POL-NO-TEXT' }), [...photos(4), okReport()]);
  assert.equal(out.policy.coverage_verdict, 'unclear');
  assert.deepEqual(out.policy.citations, []);
});

test('language guard: quoting a source verbatim is fine, the system accusing is not', () => {
  const p = { coverage_verdict: 'not_covered', reasoning: 'ok', unmatched_damage: [],
    citations: [{ policy_id: 'P', policy_name: 'N', section: 'EXC-002', clause_quote: 'Fraudulent claims will be denied', page: null, source_id: 's' }] };
  assert.doesNotThrow(() => validateAgentPayload('policy', p));
  assert.throws(() => validateAgentPayload('policy', { ...p, reasoning: 'This looks fraudulent' }), /accusatory/);
});
