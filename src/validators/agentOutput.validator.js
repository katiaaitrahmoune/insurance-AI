// Seam 1 — Agent JSON outputs. Strict on purpose: "no undocumented fields".
// Owned by the AI Engineer; the backend only enforces it at the persistence boundary.
import { z } from 'zod';
import { COVERAGE_VERDICTS, INCONSISTENCY_TYPES, RECOMMENDATIONS, SEVERITIES } from '../utils/constants.js';
import { findBannedTerm } from '../utils/bannedTerms.js';

export class AgentOutputError extends Error {
  constructor(agent, message, details) {
    super(`${agent} agent output rejected: ${message}`);
    this.name = 'AgentOutputError';
    this.agent = agent;
    this.details = details;
  }
}

const damage = z
  .object({
    part: z.string().min(1),
    description: z.string().min(1),
    confidence: z.number().min(0).max(1),
    image_ref: z.string().uuid().nullish(), // claim_files.id of the supporting photo
    region: z.string().nullish(),
    needs_verification: z.boolean().optional(), // set when confidence is under the threshold
    source_id: z.string().optional(), // backend fills this in when persisting sources
  })
  .strict();

export const visionOutputSchema = z.object({ damages: z.array(damage) }).strict();

const citation = z
  .object({
    policy_id: z.string().min(1),
    policy_name: z.string().min(1),
    section: z.string().min(1),
    clause_quote: z.string().min(1),
    page: z.number().int().positive().nullish(),
    source_id: z.string().min(1),
  })
  .strict();

export const policyOutputSchema = z
  .object({
    coverage_verdict: z.enum(COVERAGE_VERDICTS),
    citations: z.array(citation),
    reasoning: z.string().min(1),
    unmatched_damage: z.array(z.string()),
  })
  .strict()
  // Guardrail 3: a verdict other than "unclear" must carry a citable clause.
  .refine((p) => p.coverage_verdict === 'unclear' || p.citations.length > 0, {
    message: 'coverage verdict requires at least one citation',
    path: ['citations'],
  });

const evidence = z
  .object({
    source: z.string().min(1), // claim_description | accident_report | ...
    value: z.string().min(1),
    source_id: z.string().optional(),
    excerpt: z.string().optional(),
  })
  .strict();

const inconsistency = z
  .object({
    type: z.enum(INCONSISTENCY_TYPES),
    severity: z.enum(SEVERITIES),
    description: z.string().min(1),
    evidence: z.array(evidence).min(1),
  })
  .strict();

export const decisionOutputSchema = z
  .object({
    summary: z.string().min(1),
    coverage: z.enum(COVERAGE_VERDICTS),
    inconsistencies: z.array(inconsistency),
    missing_information: z.array(z.string()),
    recommendation: z.enum(RECOMMENDATIONS), // a recommendation, never a decision
    supporting_context: z
      .object({
        related_past_cases: z.array(
          z.object({ claim_id: z.string(), memory_type: z.string(), content: z.string() }).strict(),
        ),
      })
      .strict()
      .optional(), // long-term memory: supporting signal only (guardrail 5)
  })
  .strict();

const SCHEMAS = { vision: visionOutputSchema, policy: policyOutputSchema, decision: decisionOutputSchema };

/** Validate one agent payload and apply the language guardrail. Throws AgentOutputError. */
export function validateAgentPayload(agent, payload) {
  const result = SCHEMAS[agent].safeParse(payload);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AgentOutputError(agent, 'schema validation failed', details);
  }
  // The language rule governs what the SYSTEM says. Verbatim quotes of source text (a policy clause, a
  // report excerpt) are evidence, not accusations, so they are excluded from the scan.
  const scan = structuredClone(result.data);
  if (scan.citations) scan.citations = scan.citations.map((c) => ({ ...c, clause_quote: '' }));
  for (const i of scan.inconsistencies ?? []) i.evidence = i.evidence.map((e) => ({ ...e, excerpt: '' }));
  const banned = findBannedTerm(scan);
  if (banned) throw new AgentOutputError(agent, `accusatory wording is not allowed ("${banned}")`);
  return result.data;
}
