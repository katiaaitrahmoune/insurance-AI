export class AgentRunError extends Error {
  constructor(agent, code, message) {
    super(message);
    this.name = 'AgentRunError';
    this.agent = agent;
    this.code = code;
  }
}
