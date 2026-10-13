import pg from 'pg';
import { env } from '../env.js';
import { logger } from './logger.js';

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' string (no timezone surprises), BIGINT -> number
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000, // serverless Postgres (Neon) may need a moment to wake up
});
pool.on('error', (err) => logger.error({ err }, 'unexpected pg pool error'));

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const closePool = () => pool.end();
