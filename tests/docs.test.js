import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import YAML from 'yaml';
import { createApp } from '../src/app.js';
import { mockMcp } from './helpers.js';
import { closePool } from '../src/config/db.js';

const spec = YAML.parse(fs.readFileSync('docs/openapi.yaml', 'utf8'));

test('Swagger UI and the raw spec are served', async () => {
  const { app } = createApp({ mcp: mockMcp() });
  const ui = await request(app).get('/api/docs/');
  assert.equal(ui.status, 200);
  assert.match(ui.text, /swagger-ui/i);
  const json = await request(app).get('/api/openapi.json');
  assert.equal(json.body.openapi, '3.0.3');
  await closePool();
});

test('the spec documents every route the API actually serves (and nothing else)', () => {
  const src = fs.readFileSync('src/routes/index.js', 'utf8');
  const implemented = new Set(
    [...src.matchAll(/r\.(get|post|patch|delete)\('([^']+)'/g)].map(([, m, p]) => `${m.toUpperCase()} ${p.replace(/:(\w+)/g, '{$1}')}`),
  );
  const documented = new Set(
    Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).filter((k) => ['get', 'post', 'patch', 'delete'].includes(k)).map((m) => `${m.toUpperCase()} ${p}`)),
  );
  // the claim file route uses {fileId}; /sources uses {sourceId}: names match the router, so compare directly
  assert.deepEqual([...implemented].filter((x) => !documented.has(x)), [], 'routes missing from docs/openapi.yaml');
  assert.deepEqual([...documented].filter((x) => !implemented.has(x)), [], 'documented routes that do not exist');
});

test('the status enum in the spec matches the database guard', () => {
  assert.deepEqual(spec.components.schemas.Status.enum, ['PENDING', 'APPROVED', 'MORE_INFO_REQUIRED']);
});
