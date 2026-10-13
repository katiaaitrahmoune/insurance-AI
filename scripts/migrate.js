import { runMigrations } from '../src/models/migrate.js';
import { closePool } from '../src/config/db.js';

const applied = await runMigrations();
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date.');
await closePool();
