import * as claimModel from '../models/claim.model.js';
import * as analysisModel from '../models/analysis.model.js';
import { logAudit } from '../models/audit.model.js';
import { createNotification } from '../models/notification.model.js';
import { REVIEW_ACTION_TO_STATUS } from '../utils/constants.js';
import { notFound, conflict, badGateway } from '../utils/errors.js';
import { McpToolError } from './mcpClient.service.js';


export function createReviewService({ mcpReview, agents, memory, logger }) {
  async function review({ claimId, action, user }) {
    const newStatus = REVIEW_ACTION_TO_STATUS[action];

    const claimed = await claimModel.transitionAnalysis(claimId, { from: ['awaiting_review'], to: 'reviewing' });
    if (!claimed) {
      const existing = await claimModel.getClaimRow(claimId);
      if (!existing) throw notFound(`Claim ${claimId} not found`);
      throw conflict(
        `Claim ${claimId} is not awaiting review (current state: ${existing.analysis_state}) or was already reviewed.`,
        'NOT_AWAITING_REVIEW',
      );
    }

    let toolResult;
    try {
      toolResult = await mcpReview.updateClaim(claimId, newStatus);
    } catch (err) {
      
      await claimModel.setAnalysisStage(claimId, 'awaiting_review');
      logger.error({ err, claimId }, 'update_claim failed');
      if (err instanceof McpToolError) throw badGateway(`update_claim failed: ${err.message}`, `MCP_${err.code}`);
      throw err;
    }

    const analysis = await analysisModel.latestAnalysis(claimId);
    const humanDecision = {
      action,
      status: newStatus,
      reviewer: { id: user?.id ?? null, email: user?.email ?? null },
      decided_at: toolResult.updated_at,
    };

    let memorySaved = false;
    try {
      await agents.resume({ claim: claimed, analysis, humanDecision });
      const rows = agents.extractMemories({ claim: claimed, analysis, humanDecision });
      memorySaved = (await memory.save(claimId, rows)) > 0;
    } catch (err) {

      logger.error({ err, claimId }, 'post-review step failed (memory/resume)');
    }

    try {
      if (analysis) await analysisModel.saveHumanDecision(analysis.id, humanDecision);
      await claimModel.setAnalysisStage(claimId, 'reviewed', action === 'approve' ? 'decided' : 'evidence_collection');
      await logAudit(claimId, user?.email ?? 'unknown', 'review_submitted', { action, tool_call: 'update_claim', result: toolResult });
      await createNotification(claimId, `${claimId} set to ${newStatus}`, `Officer action: ${action}.`);
    } catch (err) {
      logger.error({ err, claimId }, 'could not finalize review bookkeeping');
      await claimModel.setAnalysisStage(claimId, 'reviewed').catch(() => {});
    }

    return {
      claim_id: claimId,
      old_status: toolResult.old_status,
      new_status: toolResult.new_status,
      tool_call: 'update_claim',
      tool_result: toolResult,
      memory_saved: memorySaved,
    };
  }
  return { review };
}
