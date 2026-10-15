import path from 'node:path';
import { env } from '../src/env.js';
import { pool, withTransaction, closePool } from '../src/config/db.js';
import { runMigrations } from '../src/models/migrate.js';
import { seedDemoData } from '../src/models/seed.js';
import { policyRowsFromDocs } from '../src/knowledge/policies.js';

console.log("seed.js loqique is here")
await runMigrations();
await withTransaction((db) => seedDemoData(db, path.resolve(env.DATA_DIR)));

const { rows } = await pool.query('SELECT count(*)::int AS n FROM claims');
const files = (await pool.query("SELECT count(*)::int AS n FROM claim_files WHERE claim_id='CLM-1042'")).rows[0].n;
console.log(`Seed complete: ${rows[0].n} claims, ${(await policyRowsFromDocs()).length} policies, ${files} files registered on CLM-1042.`);
await closePool();
