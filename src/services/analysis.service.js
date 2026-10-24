import * as claimModel from '../models/claim.model.js';
import * as analysisModel from '../models/analysis.model.js';
import { listFiles } from '../models/file.model.js';
import { storage } from './storage.service.js';
import { logAudit } from '../models/audit.model.js';
import { createNotification } from '../models/notification.model.js';
import { validateAgentPayload, AgentOutputError } from '../validators/agentOutput.validator.js';
import { AgentRunError } from './agents/errors.js';
import { persistSources, slug } from './source.service.js';
import { notFound, conflict } from '../utils/errors.js';


export function createAnalysisService({ agents, events, logger }) {
  const running = new Map(); 

  async function start(claimId, user) {
    const claim = await claimModel.getClaimRow(claimId);
    if (!claim) throw notFound(`Claim ${claimId} not found`);
    if (claim.status === 'APPROVED') throw conflict('This claim is already approved', 'CLAIM_ALREADY_APPROVED');

    const locked = await claimModel.transitionAnalysis(claimId, {
      from: ['not_started', 'failed', 'reviewed'], to: 'running', stage: 'ai_analysis',
    });
    if (!locked) {
      throw conflict(`Analysis cannot be started while the claim is "${claim.analysis_state}"`, 'ANALYSIS_NOT_STARTABLE');
    }
    const analysis = await analysisModel.createAnalysis(claimId);
    await logAudit(claimId, user?.email ?? 'system', 'analysis_started', { analysis_id: analysis.id });
    // Lets the UI reset its timeline for a fresh run (e.g. re-analysis after "request more information").
    await events.publish(analysis.id, claimId, { event: 'analysis_started' });

    const p = runPipeline(locked, analysis).catch((err) => logger.error({ err, claimId }, 'pipeline crashed')).finally(() => running.delete(claimId));
    running.set(claimId, p);
    return { claim_id: claimId, analysis_id: analysis.id, state: 'running' };
  }

  async function runPipeline(claim, analysis) {
    const files = (await listFiles(claim.id)).map((f) => ({ ...f, read: () => storage.read(f) }));

    const emit = async (agent, status, payload) => {
      let data = payload;
      if (payload !== undefined && status !== 'failed') {
        data = validateAgentPayload(agent, payload);
        if (agent === 'vision') {
          data = { damages: data.damages.map((d) => ({ ...d, source_id: d.source_id ?? `src_img_${claim.id}_${slug(d.part)}` })) };
        }
        await analysisModel.savePart(analysis.id, agent, data);
      }
      await events.publish(analysis.id, claim.id, { event: 'agent_status', agent, status, payload: data ?? null });
    };

    try {
      await agents.runAnalysis({ claim, files, emit });
      const done = await analysisModel.latestAnalysis(claim.id);
      if (!done?.vision || !done?.policy || !done?.decision) {
        throw new AgentRunError('decision', 'INCOMPLETE', 'The pipeline finished without a complete analysis.');
      }
      await persistSources({ claim, files, vision: done.vision, policy: done.policy, decision: done.decision });
      await claimModel.setFindings(claim.id, {
        damage_summary: done.vision.damages.map((d) => d.part).join(', '),
        coverage_status: done.decision.coverage,
        inconsistency_flag: done.decision.inconsistencies.length > 0,
      });
      await analysisModel.finishAnalysis(analysis.id, 'awaiting_review');
      await claimModel.setAnalysisStage(claim.id, 'awaiting_review', 'human_review');
      await events.publish(analysis.id, claim.id, { event: 'awaiting_review', recommendation: done.decision.recommendation });
      await createNotification(claim.id, `${claim.id} is ready for review`, 'The AI analysis is complete and awaits an officer decision.');
      await logAudit(claim.id, 'system', 'analysis_completed', { recommendation: done.decision.recommendation });
    } catch (err) {
      await handleFailure(claim, analysis, err);
    }
  }

  async function handleFailure(claim, analysis, err) {
    const known = err instanceof AgentRunError || err instanceof AgentOutputError;
    const agent = known ? err.agent : 'decision';
    const code = err instanceof AgentRunError ? err.code : err instanceof AgentOutputError ? 'INVALID_OUTPUT' : 'INTERNAL';
    const message = known ? err.message : 'The analysis stopped unexpectedly. Please try again.';
    if (!known) logger.error({ err, claimId: claim.id }, 'analysis failed');
    else logger.warn({ claimId: claim.id, agent, code, details: err.details }, 'analysis node failed');

    try {
      await analysisModel.finishAnalysis(analysis.id, 'failed', message);
      await claimModel.setAnalysisStage(claim.id, 'failed', 'evidence_collection');
      await events.publish(analysis.id, claim.id, { event: 'agent_status', agent, status: 'failed', payload: { error: { code, message } } });
      await events.publish(analysis.id, claim.id, { event: 'analysis_failed', agent, message });
      await createNotification(claim.id, `Analysis of ${claim.id} failed`, message);
      await logAudit(claim.id, 'system', 'analysis_failed', { agent, code });
    } catch (inner) {
      logger.error({ err: inner, claimId: claim.id }, 'could not record analysis failure');
    }
  }

  return {
    start,
    isRunning: (claimId) => running.has(claimId),
    whenIdle: (claimId) => running.get(claimId) ?? Promise.resolve(),
    async drain() { await Promise.allSettled([...running.values()]); },
  };
}
