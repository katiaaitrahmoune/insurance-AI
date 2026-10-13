import { createFixtureRunner } from './fixtureRunner.js';

/**
 * Agent runner factory — the seam between the Backend and the AI Engineer's graph.
 *
 * A runner must implement:
 *   runAnalysis({ claim, files, emit })  -> { vision, policy, decision }
 *       emit(agent, status, payload?) is awaited; payloads are validated by the backend before they are
 *       persisted or streamed. Throw AgentRunError(agent, code, message) for a clean, user-visible failure.
 *   resume({ claim, analysis, humanDecision })   called after the officer acts (graph leaves its pause)
 *   extractMemories({ claim, analysis, humanDecision }) -> [{ memory_type, content }]
 *
 * GUARDRAIL: runners are constructed with `graphMcp`, a client that can only call get_policy.
 * There is no update_claim for them to call, by construction.
 */
export function createAgentRunner({ mode, graphMcp, memory, delayMs }) {
  switch (mode) {
    case 'fixture':
      return createFixtureRunner({ graphMcp, memory, delayMs });
    default:
      throw new Error(`Unknown AGENT_MODE "${mode}"`);
  }
}
