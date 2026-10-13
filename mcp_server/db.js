import 'dotenv/config';
import pg from 'pg';

pg.types.setTypeParser(1700, (v) => parseFloat(v));

// The MCP server is its own process with its own pool: it is the only writer of claims.status.
export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for insuralens-mcp');
  return new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000, // serverless Postgres (Neon) may need a moment to wake up
  });
}
