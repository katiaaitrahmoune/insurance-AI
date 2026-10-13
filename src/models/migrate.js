import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { logger } from '../config/logger.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Plain versioned SQL migrations: NNN_name.sql, applied once, in order, each in a transaction. */
export async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // advisory lock: backend + seed script starting together must not double-apply
      await client.query('SELECT pg_advisory_xact_lock(727001)');
      const again = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (!again.rowCount) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        applied.push(file);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  if (applied.length) logger.info({ applied }, 'migrations applied');
  return applied;
}
