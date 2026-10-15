import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/env.js';
import { withTransaction, closePool } from '../src/config/db.js';
import { storage } from '../src/services/storage.service.js';


const all = process.argv.includes('--all');

const removed = await withTransaction(async (db) => {

  await db.query("SELECT set_config('app.status_writer', 'admin_reset', true)");

  const ids = ['CLM-1042'];
  await db.query('DELETE FROM claim_analyses WHERE claim_id = ANY($1)', [ids]);
  await db.query('DELETE FROM claim_memories WHERE claim_id = ANY($1)', [ids]);
  await db.query('DELETE FROM sources WHERE claim_id = ANY($1)', [ids]);
  await db.query('DELETE FROM notifications WHERE claim_id = ANY($1)', [ids]);
  await db.query('DELETE FROM audit_log WHERE claim_id = ANY($1)', [ids]);
  await db.query(
    `UPDATE claims SET status='PENDING', stage='evidence_collection', analysis_state='not_started',
            damage_summary=NULL, coverage_status=NULL, inconsistency_flag=false, decided_at=NULL, updated_at=now()
      WHERE id = ANY($1)`, [ids]);
  await db.query("DELETE FROM tool_call_log WHERE arguments->>'claim_id' = ANY($1)", [ids]);

  let gone = [];
  let orphaned = [];
  if (all) {
    orphaned = (await db.query("SELECT f.* FROM claim_files f WHERE substring(f.claim_id from 5)::int >= 1100")).rows;
    gone = (await db.query("DELETE FROM claims WHERE substring(id from 5)::int >= 1100 RETURNING id")).rows.map((r) => r.id);
    await db.query('DELETE FROM chat_conversations');
  }
  return { gone, orphaned };
});
await Promise.allSettled(removed.orphaned.map((f) => storage.remove(f)));
for (const id of removed.gone) await fs.rm(path.resolve(env.DATA_DIR, 'claims', id), { recursive: true, force: true });
console.log(`CLM-1042 reset to PENDING.${all ? ` Removed ${removed.gone.length} user-created claim(s).` : ''}`);
await closePool();
