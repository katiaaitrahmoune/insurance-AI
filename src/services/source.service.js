import { withTransaction } from '../config/db.js';
import { upsertSource, getSource } from '../models/source.model.js';
import { getFile } from '../models/file.model.js';
import { loadPolicyDocs, getPolicyDoc } from '../knowledge/policies.js';
import { notFound } from '../utils/errors.js';

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');


export async function persistSources({ claim, files, vision, policy, decision }) {
  const reportFile = files.find((f) => f.kind === 'report');
  await withTransaction(async (db) => {
    for (const d of vision?.damages ?? []) {
      if (!d.source_id) continue;
      await upsertSource(db, {
        source_id: d.source_id, claim_id: claim.id, kind: 'image', title: `Photo evidence: ${d.part}`,
        quote: d.description, file_id: d.image_ref ?? null, meta: { confidence: d.confidence, region: d.region ?? null },
      });
    }
    for (const c of policy?.citations ?? []) {
      const clause = (await getPolicyDoc(c.policy_id))?.clauses.find((x) => x.source_id === c.source_id);
      await upsertSource(db, {
        ...clauseSource(c.policy_name, c.policy_id, clause ?? { id: c.section, title: null, group: null, page: null, source_id: c.source_id }),
        quote: c.clause_quote,
      });
    }
    for (const inc of decision?.inconsistencies ?? []) {
      for (const ev of inc.evidence) {
        if (!ev.source_id || !ev.excerpt || ev.source === 'policy_schedule') continue; // clause sources are seeded
        const isReport = ev.source === 'accident_report';
        await upsertSource(db, {
          source_id: ev.source_id, claim_id: claim.id, kind: isReport ? 'report_excerpt' : 'claim_description',
          title: isReport ? 'Accident report' : 'Customer claim description', quote: ev.excerpt,
          file_id: isReport ? reportFile?.id ?? null : null, meta: { value: ev.value },
        });
      }
    }
  });
}


export function clauseSource(policyName, policyId, c) {
  return {
    source_id: c.source_id, claim_id: null, kind: 'policy_clause',
    title: c.title ? `${c.title} (${c.id})` : `${policyName}, ${c.id}`,
    section: c.id, page: c.page ?? null, quote: c.text ?? null,
    meta: { policy_id: policyId, policy_name: policyName, ...(c.group ? { group: c.group } : {}) },
  };
}


export async function seedPolicyClauseSources(db) {
  for (const doc of Object.values(await loadPolicyDocs())) {
    for (const c of doc.clauses) await upsertSource(db, clauseSource(doc.name, doc.policy_id, c));
  }
}

export async function resolveSource(sourceId) {
  const s = await getSource(sourceId);
  if (!s) throw notFound(`Source ${sourceId} not found`);
  const file = s.file_id ? await getFile(s.file_id) : null;
  return {
    source_id: s.source_id,
    kind: s.kind,
    title: s.title,
    section: s.section,
    page: s.page,
    quote: s.quote,
    claim_id: s.claim_id,
    meta: s.meta,
    file: file
      ? { id: file.id, name: file.original_name, mime_type: file.mime_type, url: `/api/claims/${file.claim_id}/files/${file.id}` }
      : null,
  };
}
