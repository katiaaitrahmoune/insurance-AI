import './setup.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpApp } from '../mcp_server/server.js';
import { createPool } from '../mcp_server/db.js';
import { pool, closePool } from '../src/config/db.js';
import { resetDb } from './helpers.js';

const tokens = { graph: 'g-token-1234', review: 'r-token-1234', admin: 'a-token-1234' };
let server, url, mcpPool;

before(async () => {
  await resetDb();
  mcpPool = createPool(process.env.DATABASE_URL);
  server = createMcpApp({ pool: mcpPool, tokens }).listen(0);
  url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
});
after(async () => { server.close(); await mcpPool.end(); await closePool(); });

async function connect(token) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}
const names = async (c) => (await c.listTools()).tools.map((t) => t.name).sort();

test('graph caller can see only get_policy; review caller only update_claim', async () => {
  const g = await connect(tokens.graph);
  const r = await connect(tokens.review);
  assert.deepEqual(await names(g), ['get_policy']);
  assert.deepEqual(await names(r), ['update_claim']);
  const res = await g.callTool({ name: 'update_claim', arguments: { claim_id: 'CLM-1042', status: 'APPROVED' } }).catch((e) => ({ isError: true, e }));
  assert.ok(res.isError, 'graph must not be able to call update_claim');
  await g.close(); await r.close();
});

test('MCP Inspector (admin) sees exactly the two tools', async () => {
  const a = await connect(tokens.admin);
  assert.deepEqual(await names(a), ['get_policy', 'update_claim']);
  await a.close();
});

test('get_policy returns the record; unknown id is NOT_FOUND', async () => {
  const g = await connect(tokens.graph);
  const ok = await g.callTool({ name: 'get_policy', arguments: { policy_id: 'AT-MOT-2026-X99' } });
  assert.equal(ok.structuredContent.id, 'AT-MOT-2026-X99');
  const nf = await g.callTool({ name: 'get_policy', arguments: { policy_id: 'NOPE' } });
  assert.equal(nf.isError, true);
  assert.equal(JSON.parse(nf.content[0].text).code, 'NOT_FOUND');
  await g.close();
});

test('update_claim: changes status, idempotent, validates, logs every call', async () => {
  const r = await connect(tokens.review);
  const first = await r.callTool({ name: 'update_claim', arguments: { claim_id: 'CLM-1042', status: 'MORE_INFO_REQUIRED' } });
  assert.equal(first.structuredContent.old_status, 'PENDING');
  assert.equal(first.structuredContent.new_status, 'MORE_INFO_REQUIRED');
  const again = await r.callTool({ name: 'update_claim', arguments: { claim_id: 'CLM-1042', status: 'MORE_INFO_REQUIRED' } });
  assert.equal(again.structuredContent.old_status, 'MORE_INFO_REQUIRED');
  const bad = await r.callTool({ name: 'update_claim', arguments: { claim_id: 'CLM-1042', status: 'BOGUS' } });
  assert.equal(JSON.parse(bad.content[0].text).code, 'INVALID_STATUS');
  const nf = await r.callTool({ name: 'update_claim', arguments: { claim_id: 'CLM-9999', status: 'APPROVED' } });
  assert.equal(JSON.parse(nf.content[0].text).code, 'NOT_FOUND');
  await r.close();
  const { rows } = await pool.query("SELECT ok FROM tool_call_log WHERE tool='update_claim' ORDER BY id");
  assert.deepEqual(rows.map((x) => x.ok), [true, true, false, false]);
  const claim = (await pool.query("SELECT status FROM claims WHERE id='CLM-1042'")).rows[0];
  assert.equal(claim.status, 'MORE_INFO_REQUIRED');
});

test('requests without a valid token are rejected', async () => {
  await assert.rejects(connect('wrong-token'));
});

test('the database itself rejects a status write outside update_claim', async () => {
  await assert.rejects(pool.query("UPDATE claims SET status='APPROVED' WHERE id='CLM-1042'"), /update_claim MCP tool/);
});
