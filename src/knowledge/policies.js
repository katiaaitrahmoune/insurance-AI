import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

/**
 * Policy documents are ingested from data/policies/*.md (section-aware: one chunk per `### ID: Title`
 * clause, with its section group). This is the backend's stand-in for the AI Engineer's RAG ingest:
 * it gives the fixture Policy Agent REAL clause text to cite instead of invented clauses.
 * Page numbers are not available in Markdown, so `page` is null.
 */

const META = {
  policy_id: 'Policy Identifier',
  version: 'Version',
  effective: 'Effective Dates',
  insured: 'Insured Person',
  vehicle: 'Covered Vehicle',
  coverage_type: 'Coverage Type',
};

const CATEGORY = {
  POL: 'policy', DEF: 'definition', COV: 'coverage', EXC: 'exclusion', LIM: 'limit',
  CLM: 'procedure', EVD: 'evidence', PRE: 'pre_existing', SCE: 'example', ADM: 'admin',
};

export function parsePolicyMarkdown(text, filename) {
  const meta = {};
  for (const [key, label] of Object.entries(META)) {
    const m = text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`));
    meta[key] = m ? m[1].trim() : null;
  }
  if (!meta.policy_id) return null;

  const titleLines = text.split('\n').filter((l) => /^#{1,2} (?!Section)/.test(l)).slice(0, 2).map((l) => l.replace(/^#+\s*/, '').trim());
  const eff = meta.effective?.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);

  const clauses = [];
  let group = null;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    let body = cur.lines.join('\n').trim();
    body = body.replace(new RegExp(`^${cur.id}:[^\\n]*\\n?`), '').trim(); // some clauses repeat their heading
    cur.text = body.replace(/\s+/g, ' ');
    delete cur.lines;
    if (cur.text) clauses.push(cur);
    cur = null;
  };
  for (const line of text.split('\n')) {
    const h2 = line.match(/^## (Section .+)$/);
    const h3 = line.match(/^### ([A-Z]{2,4}-\d{3}): (.+)$/);
    if (h2) { flush(); group = h2[1].trim(); continue; }
    if (h3) {
      flush();
      const id = h3[1];
      cur = { id, title: h3[2].trim(), group, category: CATEGORY[id.split('-')[0]] ?? 'other', lines: [] };
      continue;
    }
    if (/^---+\s*$/.test(line)) { flush(); continue; }
    if (cur) cur.lines.push(line);
  }
  flush();

  const policyId = meta.policy_id;
  return {
    policy_id: policyId,
    filename,
    name: titleLines.join(' — '),
    version: meta.version,
    effective_from: eff?.[1] ?? null,
    effective_to: eff?.[2] ?? null,
    insured: meta.insured,
    vehicle: meta.vehicle?.replace(/\s*\(.*\)\s*$/, '') ?? null, // drop the VIN suffix
    coverage_type: meta.coverage_type,
    clauses: clauses.map((c) => ({ ...c, policy_id: policyId, source_id: `src_pol_${policyId}_${c.id}`, page: null })),
  };
}

let cache = { dir: null, docs: null };

export async function loadPolicyDocs() {
  const dir = path.resolve(env.DATA_DIR, 'policies');
  if (cache.dir === dir && cache.docs) return cache.docs;
  const docs = {};
  const files = await fs.readdir(dir).catch(() => []);
  for (const f of files.filter((x) => x.endsWith('.md'))) {
    const parsed = parsePolicyMarkdown(await fs.readFile(path.join(dir, f), 'utf8'), f);
    if (parsed) docs[parsed.policy_id] = parsed;
  }
  cache = { dir, docs };
  return docs;
}

export const getPolicyDoc = async (policyId) => (await loadPolicyDocs())[policyId] ?? null;
export const clearPolicyCache = () => { cache = { dir: null, docs: null }; };

/** Rows for the `policies` table, derived from the ingested documents (nothing invented). */
export async function policyRowsFromDocs() {
  return Object.values(await loadPolicyDocs()).map((d) => ({
    id: d.policy_id,
    name: d.name,
    filename: d.filename,
    coverage_summary: `${d.coverage_type}. Effective ${d.effective_from} to ${d.effective_to}. Insured: ${d.insured}. Vehicle: ${d.vehicle}.`,
  }));
}

// vehicle part -> what kind of loss it is. This policy is "Collision Damage Only" (COV-001), so
// non-collision categories have no matching clause and are reported as unmatched, never assumed covered.
export const PART_CATEGORY = {
  'front bumper': 'collision', 'rear bumper': 'collision', 'left headlight': 'collision', 'right headlight': 'collision',
  hood: 'collision', 'trunk lid': 'collision', 'left front door': 'collision', 'right front door': 'collision',
  'left side mirror': 'collision', 'left fender': 'collision', 'right fender': 'collision', 'body panel': 'collision',
  windshield: 'glass', 'rear window': 'glass',
};
