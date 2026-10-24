import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class McpToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'McpToolError';
    this.code = code; 
  }
}

async function callTool({ url, token }, name, args) {
  const client = new Client({ name: 'insuralens-backend', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) {
      let parsed;
      try { parsed = JSON.parse(res.content?.[0]?.text ?? '{}'); } catch { parsed = {}; }
      throw new McpToolError(parsed.code ?? 'INTERNAL', parsed.message ?? res.content?.[0]?.text ?? 'MCP tool error');
    }
    if (res.structuredContent) return res.structuredContent;
    return JSON.parse(res.content[0].text);
  } catch (err) {
    if (err instanceof McpToolError) throw err;
    throw new McpToolError('TRANSPORT', `MCP call ${name} failed: ${err.message}`);
  } finally {
    await client.close().catch(() => {});
  }
}


export function createMcpClients({ url, graphToken, reviewToken }) {
  const graph = Object.freeze({
    getPolicy: (policyId) => callTool({ url, token: graphToken }, 'get_policy', { policy_id: policyId }),
  });
  const review = Object.freeze({
    updateClaim: (claimId, status) => callTool({ url, token: reviewToken }, 'update_claim', { claim_id: claimId, status }),
  });
  return { graph, review };
}
