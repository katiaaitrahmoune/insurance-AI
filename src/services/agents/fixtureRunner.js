// Deterministic stand-in for the AI Engineer's LangGraph pipeline (AGENT_MODE=fixture).
// It honours the exact same contract the real graph must: emit status events, return schema-valid
// outputs, and receive ONLY a get_policy-capable MCP client (no update_claim anywhere in reach).
// Clause text comes from the ingested policy document (data/policies/*.md); nothing is invented.
import { AgentRunError } from './errors.js';
import { PART_CATEGORY, getPolicyDoc } from '../../knowledge/policies.js';
import { storage } from '../storage.service.js';
import { extractTextFromBuffer } from '../../utils/text.js';
import { extractAccidentDate, datesDiffer } from '../../utils/dateCheck.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../../utils/constants.js';

const VISION_BY_INCIDENT = {
  front_end_collision: [['front bumper', 'visible damage', 0.91], ['left headlight', 'cracked', 0.87]],
  rear_end_collision: [['rear bumper', 'dented and misaligned', 0.9], ['trunk lid', 'creased', 0.82]],
  side_impact: [['left front door', 'dented', 0.88], ['left side mirror', 'possibly detached', 0.55]],
  glass_damage: [['windshield', 'cracked', 0.93]],
  other: [['body panel', 'visible damage', 0.7]],
};

const COMMERCIAL = /\b(uber|lyft|ride[- ]?shar\w*|taxi|food delivery|delivery (driver|job|service|shift)|doordash|deliveroo)\b/i; // EXC-004
const INTENTIONAL = /\b(on purpose|deliberate(ly)?|intentional(ly)?|meant to (hit|crash|ram))\b/i; // EXC-001
const THIRD_PARTY = /\b(another (vehicle|car|driver)|other (vehicle|car|driver)|struck by|hit by|failed to yield|rear-ended|van|truck)\b/i; // COV-002
const MIN_PHOTOS = 4; // CLM-002

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const iso = (d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

async function loadEvidence(claim, files) {
  const reportFiles = files.filter((f) => f.kind === 'report');
  let reportText = '';
  for (const f of reportFiles) {
    // Any file row works: the storage layer reads local disk or Cloudinary as the row dictates.
    const bytes = await (f.read ? f.read() : storage.read(f)).catch(() => null);
    if (bytes) reportText += `${await extractTextFromBuffer(bytes, f.mime_type)}\n`;
  }
  return {
    reportFiles,
    reportText,
    statement: extractAccidentDate(claim.description),
    report: extractAccidentDate(reportText),
  };
}

export function createFixtureRunner({ graphMcp, memory, delayMs = 0 }) {
  async function vision({ claim, files }) {
    const images = files.filter((f) => f.kind === 'image');
    if (!images.length) throw new AgentRunError('vision', 'NO_IMAGES', 'No damage photos were uploaded for this claim.');
    const spec = VISION_BY_INCIDENT[claim.incident_type] ?? VISION_BY_INCIDENT.other;
    return {
      damages: spec.map(([part, description, confidence], i) => ({
        part, description, confidence,
        image_ref: images[i % images.length].id,
        ...(confidence < LOW_CONFIDENCE_THRESHOLD ? { needs_verification: true } : {}),
      })),
    };
  }

  async function policy({ claim, vision: v, ev }) {
    let record;
    try {
      record = await graphMcp.getPolicy(claim.policy_id);
    } catch (e) {
      throw new AgentRunError('policy', e.code === 'NOT_FOUND' ? 'POLICY_NOT_FOUND' : 'MCP_ERROR', `Could not load policy ${claim.policy_id}: ${e.message}`);
    }
    const doc = await getPolicyDoc(record.id);
    const allParts = v.damages.map((d) => d.part);
    if (!doc) {
      return {
        coverage_verdict: 'unclear', citations: [],
        reasoning: `No clause text has been ingested for ${record.name}, so coverage cannot be established from the policy.`,
        unmatched_damage: allParts,
      };
    }
    const cite = (id) => {
      const c = doc.clauses.find((x) => x.id === id);
      return c && { policy_id: doc.policy_id, policy_name: doc.name, section: c.id, clause_quote: c.text, page: c.page, source_id: c.source_id };
    };
    const result = (coverage_verdict, ids, reasoning, unmatched_damage = []) => ({
      coverage_verdict, citations: ids.map(cite).filter(Boolean), reasoning, unmatched_damage,
    });

    // POL-002: the policy period is judged on the date the accident occurred (not the report/claim date).
    const dated = [ev.report, ev.statement].filter((d) => d?.year).map((d) => ({ d, within: iso(d) >= doc.effective_from && iso(d) <= doc.effective_to }));
    if (dated.length && dated.every((x) => !x.within)) {
      return result('not_covered', ['POL-002'],
        `The accident date (${dated[0].d.raw}) falls outside the policy period ${doc.effective_from} to ${doc.effective_to} (POL-002).`, allParts);
    }
    if (dated.some((x) => x.within) && dated.some((x) => !x.within)) {
      return result('unclear', ['POL-002'],
        'The submitted evidence gives accident dates both inside and outside the policy period, so the policy period (POL-002) cannot be confirmed.', allParts);
    }
    const periodIds = dated.length ? ['POL-002'] : [];
    const text = `${claim.description}\n${ev.reportText}`;

    // Exclusions are always considered alongside coverage clauses.
    if (COMMERCIAL.test(text)) {
      return result('not_covered', ['EXC-004', ...periodIds], 'The evidence indicates commercial use of the vehicle, which exclusion EXC-004 addresses.', allParts);
    }
    if (INTENTIONAL.test(text)) {
      // EXC-001: never an automatic denial. Flag for mandatory human review.
      return result('unclear', ['EXC-001'],
        'The evidence contains wording suggesting a deliberate act. Under EXC-001 this requires mandatory human review; no coverage conclusion is reached automatically.', allParts);
    }

    const matched = v.damages.filter((d) => (PART_CATEGORY[d.part] ?? 'collision') === 'collision');
    const unmatched = v.damages.filter((d) => !matched.includes(d)).map((d) => d.part);
    if (!matched.length) {
      return result('unclear', [], `This policy covers collision damage only (${doc.coverage_type}); no clause was found that addresses: ${unmatched.join(', ')}.`, unmatched);
    }
    const ids = ['COV-001', ...(THIRD_PARTY.test(text) ? ['COV-002'] : []), ...periodIds];
    const verdict = unmatched.length ? 'partial' : 'covered';
    return result(
      verdict, ids,
      `Detected damage (${matched.map((d) => d.part).join(', ')}) is accidental collision damage addressed by ${ids.filter((i) => i.startsWith('COV')).join(' and ')}` +
        `${periodIds.length ? `; the accident date is within the policy period (POL-002)` : ''}` +
        `${unmatched.length ? `. No clause found for: ${unmatched.join(', ')}` : ''}.`,
      unmatched,
    );
  }

  async function decision({ claim, files, vision: v, policy: p, ev }) {
    const inconsistencies = [];
    const missing = [];
    const doc = await getPolicyDoc(claim.policy_id);

    // Deterministic checks first: code finds the facts, wording explains them.
    if (doc) {
      const pol003 = doc.clauses.find((c) => c.id === 'POL-003');
      const nameDiffers = norm(claim.customer_name) !== norm(doc.insured);
      const vehicleDiffers = !(norm(claim.vehicle).includes(norm(doc.vehicle)) || norm(doc.vehicle).includes(norm(claim.vehicle)));
      if (nameDiffers || vehicleDiffers) {
        inconsistencies.push({
          type: 'other', severity: 'medium',
          description: 'The claimant name or vehicle on the claim differs from the policy schedule (POL-003).',
          evidence: [
            { source: 'claim_record', value: `${claim.customer_name}, ${claim.vehicle}` },
            { source: 'policy_schedule', value: `${doc.insured}, ${doc.vehicle}`, ...(pol003 ? { source_id: pol003.source_id, excerpt: pol003.text } : {}) },
          ],
        });
      }
    }

    if (!ev.reportFiles.length) {
      missing.push('Accident report was not provided (EVD-002 requires one when another vehicle is involved)');
      inconsistencies.push({
        type: 'missing_document', severity: 'medium',
        description: 'No accident report was submitted with this claim.',
        evidence: [{ source: 'accident_report', value: 'not provided' }],
      });
    } else if (!ev.reportText.trim()) {
      missing.push('Accident report text could not be read');
    }
    if (ev.statement && ev.report && datesDiffer(ev.statement, ev.report)) {
      inconsistencies.push({
        type: 'date_mismatch', severity: 'high',
        description: 'Dates differ between customer statement and official report.',
        evidence: [
          { source: 'claim_description', value: ev.statement.raw, source_id: `src_desc_${claim.id}`, excerpt: ev.statement.excerpt },
          { source: 'accident_report', value: ev.report.raw, source_id: `src_rpt_${claim.id}`, excerpt: ev.report.excerpt },
        ],
      });
    }

    const photoCount = files.filter((f) => f.kind === 'image').length;
    if (photoCount < MIN_PHOTOS) missing.push(`CLM-002 requires at least four clear photographs; ${photoCount} provided`);
    for (const d of v.damages.filter((x) => x.needs_verification)) {
      missing.push(`Needs verification: ${d.part} (confidence ${d.confidence})`);
    }
    if (p.citations.some((c) => c.section === 'EXC-001')) {
      missing.push('Possible intentional-damage indicators: mandatory human review required (EXC-001)');
    }

    // Long-term memory: supporting context only. It is never an input to `recommendation`.
    const related = inconsistencies.length
      ? await memory.findRelated({
          types: ['inconsistency'],
          keywords: inconsistencies.filter((i) => i.type !== 'other').map((i) => i.type.replace('_', ' ')),
          excludeClaimId: claim.id,
          limit: 3,
        })
      : [];

    const needsHuman = inconsistencies.length > 0 || p.coverage_verdict !== 'covered' || missing.length > 0;
    const parts = v.damages.map((d) => d.part).join(', ');
    return {
      summary: `${v.damages.length} damaged part${v.damages.length === 1 ? '' : 's'} identified: ${parts}.`,
      coverage: p.coverage_verdict,
      inconsistencies,
      missing_information: missing,
      recommendation: needsHuman ? 'request_more_information' : 'approve',
      ...(related.length
        ? { supporting_context: { related_past_cases: related.map((r) => ({ claim_id: r.claim_id, memory_type: r.memory_type, content: r.content })) } }
        : {}),
    };
  }

  return {
    mode: 'fixture',

    async runAnalysis({ claim, files, emit }) {
      const out = {};
      const ev = await loadEvidence(claim, files);
      await emit('vision', 'running');
      await sleep(delayMs);
      out.vision = await vision({ claim, files });
      await emit('vision', out.vision.damages.some((d) => d.needs_verification) ? 'flagged' : 'completed', out.vision);

      await emit('policy', 'running');
      await sleep(delayMs);
      out.policy = await policy({ claim, vision: out.vision, ev });
      await emit('policy', out.policy.coverage_verdict === 'covered' ? 'completed' : 'flagged', out.policy);

      await emit('decision', 'running');
      await sleep(delayMs);
      out.decision = await decision({ claim, files, vision: out.vision, policy: out.policy, ev });
      await emit('decision', out.decision.inconsistencies.length || out.decision.missing_information.length ? 'flagged' : 'completed', out.decision);
      return out;
    },

    /** The graph pauses at human review; resume receives the officer's action. */
    async resume() {
      return { resumed: true };
    },

    /** Lightweight extraction after a claim closes -> rows for claim_memories. */
    extractMemories({ analysis, humanDecision }) {
      const rows = [{ memory_type: 'outcome', content: humanDecision.action === 'approve' ? 'Approved' : 'Request more information' }];
      for (const i of analysis?.decision?.inconsistencies ?? []) {
        rows.push({ memory_type: 'inconsistency', content: i.type === 'date_mismatch' ? 'Accident date mismatch' : `${i.type.replace(/_/g, ' ')} detected` });
      }
      const verdict = analysis?.policy?.coverage_verdict;
      if (verdict) {
        const collision = analysis.policy.citations?.some((c) => c.section.startsWith('COV-'));
        rows.push({ memory_type: 'coverage', content: `${collision ? 'Collision damage' : 'Coverage'} ${verdict.replace('_', ' ')}` });
      }
      return rows;
    },
  };
}
