// Smoke test for the configured storage driver. Run it once after setting Cloudinary credentials:
//   STORAGE_DRIVER=cloudinary npm run storage:check
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../src/env.js';
import { storage } from '../src/services/storage.service.js';

const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'chk-')), 'hello.txt');
await fs.writeFile(tmp, 'InsuraLens storage check');
console.log(`driver: ${env.STORAGE_DRIVER}`);
const put = await storage.put({ claimId: 'CLM-CHECK', srcPath: tmp, filename: 'hello.txt', mimeType: 'text/plain', kind: 'report' });
console.log('1/3 stored      ', put.storage, put.public_id ?? put.stored_path);
const row = { ...put, id: 'check' };
const back = (await storage.read(row)).toString();
if (back !== 'InsuraLens storage check') throw new Error(`read-back mismatch: "${back}"`);
console.log('2/3 read back   OK (through the same path the API uses)');
await storage.remove(row);
console.log('3/3 removed     OK');
console.log('Storage is ready.');
