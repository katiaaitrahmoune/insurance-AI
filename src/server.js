import { env } from './env.js';
import { logger } from './config/logger.js';
import { closePool } from './config/db.js';
import { runMigrations } from './models/migrate.js';
import { recoverInterruptedWork } from './models/recovery.js';
import { createApp } from './app.js';

if (env.RUN_MIGRATIONS_ON_START) await runMigrations();
const recovered = await recoverInterruptedWork();
if (recovered.analyses.length || recovered.reviews.length) logger.warn(recovered, 'recovered claims interrupted by a restart');

const { app, shutdown } = createApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, agentMode: env.AGENT_MODE }, 'insuralens-backend listening'));

let closing = false;
async function stop(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  await shutdown().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => stop(s)));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
