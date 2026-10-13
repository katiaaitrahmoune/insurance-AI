import * as chatModel from '../models/chat.model.js';
import * as claimModel from '../models/claim.model.js';
import { latestAnalysis } from '../models/analysis.model.js';
import { HELP_TEXT, HUMAN_DECISION_TEXT, ACCUSATION_TEXT, GLOSSARY } from '../knowledge/chat.js';
import { notFound, ApiError } from '../utils/errors.js';
import { serializeMessage } from '../utils/serializers.js';

const CLAIM_RE = /\bCLM-\d{3,10}\b/i;

/**
 * Rule-based, evidence-grounded chat. It can start an analysis (the same code path as the REST
 * endpoint) and explain stored findings with their sources. It cannot change a claim's status:
 * this service is not given the review service.
 */
export function createChatService({ analysis }) {
  async function ensureConversation(user, { conversation_id, claim_id }, content) {
    if (conversation_id) {
      const c = await chatModel.getConversation(conversation_id, user.id);
      if (!c) throw notFound('Conversation not found');
      return c;
    }
    const title = content.length > 48 ? `${content.slice(0, 45)}...` : content;
    return chatModel.createConversation(user.id, claim_id, title);
  }

  const sourcesOf = (a) => {
    const out = [];
    for (const c of a?.policy?.citations ?? []) out.push({ source_id: c.source_id, title: `${c.policy_name}, Section ${c.section}` });
    for (const d of a?.vision?.damages ?? []) if (d.source_id) out.push({ source_id: d.source_id, title: `Photo: ${d.part}` });
    for (const i of a?.decision?.inconsistencies ?? []) for (const e of i.evidence) if (e.source_id) out.push({ source_id: e.source_id, title: e.source === 'accident_report' ? 'Accident report' : 'Claim description' });
    return out;
  };

  async function reply({ text, claimId, user }) {
    const lower = text.toLowerCase();

    if (/\banaly[sz]e\b/.test(lower)) {
      if (!claimId) return { content: 'Which claim should I analyze? Mention its ID, for example "Analyze CLM-1042".' };
      try {
        const r = await analysis.start(claimId, user);
        return {
          content: `Starting the analysis of ${claimId}. The Vision, Policy and Decision agents will run in order; you can follow their progress on the claim timeline. When they finish, the claim waits for an officer's decision.`,
          meta: { action: 'analysis_started', claimId, analysisId: r.analysis_id },
        };
      } catch (e) {
        if (e instanceof ApiError) return { content: `I could not start that analysis: ${e.message}`, meta: { action: 'analysis_rejected', code: e.code } };
        throw e;
      }
    }

    if (/fraud|lying|liar|cheat|deceiv|scam/.test(lower)) return { content: ACCUSATION_TEXT };
    if (/^\s*(please\s+)?(approve|deny|reject|decline|close)\b|can you (approve|deny|reject)|who (decides|approves)|auto.?approve/.test(lower)) return { content: HUMAN_DECISION_TEXT };

    if (claimId) {
      const claim = await claimModel.getClaimRow(claimId);
      if (!claim) return { content: `I could not find a claim with ID ${claimId}.` };
      const a = await latestAnalysis(claimId);
      const hasResults = a?.decision && ['awaiting_review', 'reviewed'].includes(a.state);
      if (!hasResults) {
        return { content: `${claimId} has no completed analysis yet (analysis state: ${claim.analysis_state.replace('_', ' ')}). Say "Analyze ${claimId}" to run it.` };
      }
      const d = a.decision;
      const sources = sourcesOf(a);
      if (/inconsisten|mismatch|differ|date/.test(lower)) {
        if (!d.inconsistencies.length) return { content: `No inconsistencies were detected between the submitted evidence for ${claimId}.`, sources };
        const lines = d.inconsistencies.map((i) => `${i.description} (${i.evidence.map((e) => `${e.source.replace('_', ' ')}: ${e.value}`).join(' vs. ')})`);
        return { content: `Inconsistency detected for ${claimId}: ${lines.join('; ')}. The officer should review both sources.`, sources };
      }
      if (/coverage|covered|policy|clause|section/.test(lower)) {
        const cites = (a.policy?.citations ?? []).map((c) => `Section ${c.section} (page ${c.page ?? 'n/a'})`).join(', ');
        return { content: `Coverage for ${claimId}: ${d.coverage.replace('_', ' ')}${cites ? `, based on ${cites}` : ''}. ${a.policy?.reasoning ?? ''}`.trim(), sources };
      }
      if (/damage|photo|image|part/.test(lower)) {
        const parts = (a.vision?.damages ?? []).map((x) => `${x.part} (${x.description}, confidence ${Math.round(x.confidence * 100)}%)`).join('; ');
        return { content: `Damage identified for ${claimId}: ${parts}.`, sources };
      }
      if (/recommend|next|what should|decision|status/.test(lower)) {
        return {
          content: `AI recommendation for ${claimId} (not a decision): ${d.recommendation.replace(/_/g, ' ')}. Current claim status: ${claim.status}.`,
          sources,
        };
      }
      return { content: `${d.summary} Coverage: ${d.coverage.replace('_', ' ')}. Recommendation (not a decision): ${d.recommendation.replace(/_/g, ' ')}.`, sources };
    }

    for (const [term, def] of Object.entries(GLOSSARY)) if (lower.includes(term)) return { content: def };
    return { content: HELP_TEXT };
  }

  async function sendMessage(user, body) {
    const conv = await ensureConversation(user, body, body.content);
    const claimId = (body.content.match(CLAIM_RE)?.[0] ?? body.claim_id ?? conv.claim_id)?.toUpperCase();
    const userMsg = await chatModel.addMessage(conv.id, 'user', body.content);
    const r = await reply({ text: body.content, claimId, user });
    const botMsg = await chatModel.addMessage(conv.id, 'assistant', r.content, r.sources ?? [], r.meta ?? {});
    return { conversationId: conv.id, messages: [serializeMessage(userMsg), serializeMessage(botMsg)] };
  }

  async function getConversation(user, id) {
    const c = await chatModel.getConversation(id, user.id);
    if (!c) throw notFound('Conversation not found');
    return { id: c.id, claimId: c.claim_id, title: c.title, createdAt: c.created_at, messages: (await chatModel.listMessages(id)).map(serializeMessage) };
  }

  return { sendMessage, getConversation };
}
