import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createPool } from './db.js';
import { registerGetPolicy } from './tools/get_policy.js';
import { registerUpdateClaim } from './tools/update_claim.js';

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Caller roles -> tool registry. The agent graph authenticates as "graph" and its server instance
 * only HAS get_policy; update_claim is not merely forbidden to it, it does not exist for it.
 * "admin" (both tools) exists only so the MCP Inspector can exercise each tool in development.
 */
const TOOLS_BY_ROLE = {
  graph: [registerGetPolicy],
  review: [registerUpdateClaim],
  admin: [registerGetPolicy, registerUpdateClaim],
};

export function createMcpApp({ pool, tokens }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'insuralens-mcp' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'insuralens-mcp' });
    }
  });

  const authenticate = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const role = Object.entries(tokens).find(([, t]) => t && same(t, token))?.[0];
    if (!role) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    }
    req.mcpCaller = role;
    next();
  };

  app.post('/mcp', authenticate, async (req, res) => {
    const caller = req.mcpCaller;
    const server = new McpServer({ name: 'insuralens-mcp', version: '1.0.0' });
    for (const register of TOOLS_BY_ROLE[caller]) register(server, { pool, caller });
    // Stateless Streamable HTTP: a fresh server+transport per request keeps role isolation airtight.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const notAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const tokens = {
    graph: process.env.MCP_GRAPH_TOKEN,
    review: process.env.MCP_REVIEW_TOKEN,
    admin: process.env.MCP_ADMIN_TOKEN, // optional: MCP Inspector only
  };
  if (!tokens.graph || !tokens.review) throw new Error('MCP_GRAPH_TOKEN and MCP_REVIEW_TOKEN are required');
  const port = Number(process.env.PORT || process.env.MCP_PORT || 5100); // Render injects PORT
  const app = createMcpApp({ pool: createPool(), tokens });
  app.listen(port, '0.0.0.0', () => console.log(`insuralens-mcp listening on :${port}/mcp`));
}
