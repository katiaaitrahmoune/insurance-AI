import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAccidentDate, datesDiffer, parseDates } from '../src/utils/dateCheck.js';
import { findBannedTerm } from '../src/utils/bannedTerms.js';
import { validateAgentPayload, AgentOutputError } from '../src/validators/agentOutput.validator.js';

test('date check catches the seeded March 12 vs March 15 mismatch', () => {
  const a = extractAccidentDate('The accident happened on March 12, 2026 at the junction.');
  const b = extractAccidentDate('Narrative: The accident occurred on March 15, 2026 at the junction.');
  assert.equal(a.day, 12);
  assert.equal(b.day, 15);
  assert.ok(datesDiffer(a, b));
});

test('date check: same date in different formats is not a mismatch', () => {
  assert.equal(datesDiffer(extractAccidentDate('The accident was on 12 March 2026.'), extractAccidentDate('Collision occurred 2026-03-12.')), false);
  assert.equal(parseDates('no dates here').length, 0);
});

test('banned-term filter', () => {
  assert.ok(findBannedTerm('Fraud detected'));
  assert.ok(findBannedTerm({ a: 'looks fraudulent' }));
  assert.equal(findBannedTerm('Inconsistency detected: accident dates differ'), null);
});

const goodPolicy = {
  coverage_verdict: 'covered', reasoning: 'ok', unmatched_damage: [],
  citations: [{ policy_id: 'P', policy_name: 'N', section: '4.2', clause_quote: 'q', page: 7, source_id: 's' }],
};

test('policy output: a verdict without a citation is rejected (guardrail 3)', () => {
  assert.throws(() => validateAgentPayload('policy', { ...goodPolicy, citations: [] }), AgentOutputError);
  assert.doesNotThrow(() => validateAgentPayload('policy', goodPolicy));
  assert.doesNotThrow(() => validateAgentPayload('policy', { coverage_verdict: 'unclear', citations: [], reasoning: 'none', unmatched_damage: ['hood'] }));
});

test('agent outputs: undocumented fields and accusatory wording are rejected', () => {
  assert.throws(() => validateAgentPayload('policy', { ...goodPolicy, extra: 1 }), AgentOutputError);
  const decision = { summary: 's', coverage: 'covered', inconsistencies: [], missing_information: [], recommendation: 'approve' };
  assert.doesNotThrow(() => validateAgentPayload('decision', decision));
  assert.throws(() => validateAgentPayload('decision', { ...decision, summary: 'Fraud detected' }), /accusatory/);
  assert.throws(() => validateAgentPayload('decision', { ...decision, recommendation: 'deny' }), AgentOutputError);
});

test('vision output: confidence must be 0..1', () => {
  assert.throws(() => validateAgentPayload('vision', { damages: [{ part: 'hood', description: 'dent', confidence: 1.4 }] }));
});
