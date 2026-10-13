import './setup.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/config/db.js';
import { recoverInterruptedWork } from '../src/models/recovery.js';
import { resetDb } from './helpers.js';

after(closePool);

test('a restart mid-analysis or mid-review leaves claims retryable, and never touches status', async () => {
  await resetDb();
  await pool.query("INSERT INTO claim_analyses (claim_id) VALUES ('CLM-1042')");
  await pool.query("UPDATE claims SET analysis_state='running', stage='ai_analysis' WHERE id='CLM-1042'");
  await pool.query("UPDATE claims SET analysis_state='reviewing' WHERE id='CLM-1001'");

  const r = await recoverInterruptedWork();
  assert.deepEqual(r.analyses, ['CLM-1042']);
  assert.deepEqual(r.reviews, ['CLM-1001']);

  const a = (await pool.query("SELECT analysis_state, stage, status FROM claims WHERE id='CLM-1042'")).rows[0];
  assert.deepEqual(a, { analysis_state: 'failed', stage: 'evidence_collection', status: 'PENDING' });
  assert.match((await pool.query('SELECT error FROM claim_analyses ORDER BY id DESC LIMIT 1')).rows[0].error, /interrupted/);
  assert.equal((await pool.query("SELECT analysis_state FROM claims WHERE id='CLM-1001'")).rows[0].analysis_state, 'awaiting_review');
  assert.deepEqual(await recoverInterruptedWork().then((x) => [x.analyses, x.reviews]), [[], []], 'idempotent');
});
