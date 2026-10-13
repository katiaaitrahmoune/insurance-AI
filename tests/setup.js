// Import FIRST in every test file: points the app at the test database and a throw-away data dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insuralens-test-'));
fs.cpSync(path.resolve('data/images'), path.join(dataDir, 'images'), { recursive: true });
fs.cpSync(path.resolve('data/claims'), path.join(dataDir, 'claims'), { recursive: true });
fs.cpSync(path.resolve('data/policies'), path.join(dataDir, 'policies'), { recursive: true });

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://insura:insura@127.0.0.1:5432/insuralens_test',
  DATA_DIR: dataDir,
  JWT_SECRET: 'test-secret-test-secret-123',
  MCP_GRAPH_TOKEN: 'graph-token-test-01',
  MCP_REVIEW_TOKEN: 'review-token-test-01',
  AGENT_STEP_DELAY_MS: '0',
  RUN_MIGRATIONS_ON_START: 'false',
});
export { dataDir };
