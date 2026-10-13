import { dataDir } from './setup.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createStorage, setStorage, storage as originalStorage } from '../src/services/storage.service.js';
import { parseEnv } from '../src/env.js';
import { createApp } from '../src/app.js';
import { pool, closePool } from '../src/config/db.js';
import { resetDb, mockMcp, login, analyzeAndWait } from './helpers.js';

const tmpFile = (name, content) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), name);
  fs.writeFileSync(f, content);
  return f;
};
const readAll = async (stream) => { const c = []; for await (const x of stream) c.push(x); return Buffer.concat(c).toString(); };

/** In-memory stand-in for the Cloudinary SDK + its signed delivery URLs. */
function fakeCloudinary({ failUploadOn = null } = {}) {
  const store = new Map();
  const calls = { upload: [], destroy: [], url: [] };
  let n = 0;
  return {
    store, calls,
    client: {
      uploader: {
        upload: async (src, opts) => {
          if (failUploadOn && ++n === failUploadOn) throw new Error('cloudinary down');
          const id = `${opts.folder}/${opts.public_id}`;
          store.set(id, fs.readFileSync(src));
          calls.upload.push({ src, opts });
          return { public_id: id, resource_type: opts.resource_type };
        },
        destroy: async (id, opts) => { calls.destroy.push({ id, opts }); store.delete(id); return { result: 'ok' }; },
      },
      url: (id, opts) => { calls.url.push({ id, opts }); return `https://signed.example/${encodeURIComponent(id)}`; },
    },
    fetchImpl: async (url) => {
      const buf = store.get(decodeURIComponent(url.split('/').pop()));
      return buf ? new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } }) : new Response('no', { status: 404 });
    },
  };
}
const cloudStorage = (fake) => createStorage({ driver: 'cloudinary', dataDir, cloudinary: fake.client, folder: 'insuralens', fetchImpl: fake.fetchImpl });

after(async () => { setStorage(originalStorage); await closePool(); });

test('local driver: stores a RELATIVE, forward-slashed path; read/open/remove work', async () => {
  const s = createStorage({ driver: 'local', dataDir });
  const src = tmpFile('abc123.txt', 'hello');
  const put = await s.put({ claimId: 'CLM-T1', srcPath: src, filename: 'x.txt', mimeType: 'text/plain', kind: 'report' });
  assert.equal(put.storage, 'local');
  assert.equal(put.stored_path, 'claims/CLM-T1/abc123.txt');
  assert.equal(fs.existsSync(src), false, 'temp file was moved');
  const row = { ...put };
  assert.equal((await s.read(row)).toString(), 'hello');
  assert.equal(await readAll((await s.open(row)).stream), 'hello');
  await s.remove(row);
  await assert.rejects(s.open(row), /no longer on disk/);
});

test('local driver: keepSource references in place only inside DATA_DIR; legacy absolute paths and traversal', async () => {
  const s = createStorage({ driver: 'local', dataDir });
  const inside = path.join(dataDir, 'images', 'CLM-1042_front_bumper.jpg');
  assert.equal((await s.put({ claimId: 'CLM-1042', srcPath: inside, filename: 'a.jpg', mimeType: 'image/jpeg', kind: 'image', keepSource: true })).stored_path, 'images/CLM-1042_front_bumper.jpg');
  await assert.rejects(s.put({ claimId: 'CLM-1042', srcPath: tmpFile('o.jpg', 'x'), filename: 'o.jpg', mimeType: 'image/jpeg', kind: 'image', keepSource: true }), /inside DATA_DIR/);
  assert.ok((await s.read({ storage: 'local', stored_path: inside })).length > 100, 'legacy absolute rows still resolve');
  await assert.rejects(s.read({ storage: 'local', stored_path: '../../../etc/passwd' }), (e) => e.status === 404);
});

test('cloudinary driver: authenticated upload (no public URL), correct resource types, signed read, destroy', async () => {
  const fake = fakeCloudinary();
  const s = cloudStorage(fake);
  const img = tmpFile('p.jpg', 'JPEGDATA');
  const pdf = tmpFile('r.pdf', 'PDFDATA');

  const a = await s.put({ claimId: 'CLM-T2', srcPath: img, filename: 'p.jpg', mimeType: 'image/jpeg', kind: 'image' });
  const b = await s.put({ claimId: 'CLM-T2', srcPath: pdf, filename: 'r.pdf', mimeType: 'application/pdf', kind: 'report' });
  const [ua, ub] = fake.calls.upload;
  assert.equal(ua.opts.type, 'authenticated');
  assert.equal(ua.opts.resource_type, 'image');
  assert.equal(ub.opts.resource_type, 'raw');
  assert.match(ub.opts.public_id, /\.pdf$/, 'raw assets keep their extension');
  assert.doesNotMatch(ua.opts.public_id, /\.jpg$/, 'image public_ids carry no extension');
  assert.equal(ua.opts.folder, 'insuralens/claims/CLM-T2');
  assert.deepEqual([a.storage, a.stored_path, b.resource_type], ['cloudinary', null, 'raw']);
  assert.equal(fs.existsSync(img), false, 'temp upload removed after Cloudinary has it');

  assert.equal((await s.read(b)).toString(), 'PDFDATA');
  assert.equal(await readAll((await s.open(a)).stream), 'JPEGDATA');
  const signed = fake.calls.url.at(-1);
  assert.deepEqual([signed.opts.type, signed.opts.sign_url, signed.opts.secure], ['authenticated', true, true]);

  await s.remove(b);
  assert.deepEqual(fake.calls.destroy[0].opts, { resource_type: 'raw', type: 'authenticated', invalidate: true });
  await assert.rejects(s.read(b), (e) => e.status === 404);
});

test('env: cloudinary driver demands credentials; local needs none', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(16), MCP_GRAPH_TOKEN: 'g'.repeat(8), MCP_REVIEW_TOKEN: 'r'.repeat(8) };
  assert.equal(parseEnv(base).STORAGE_DRIVER, 'local');
  assert.throws(() => parseEnv({ ...base, STORAGE_DRIVER: 'cloudinary' }), /CLOUDINARY_URL/);
  assert.doesNotThrow(() => parseEnv({ ...base, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_URL: 'cloudinary://k:s@cloud' }));
  assert.doesNotThrow(() => parseEnv({ ...base, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }));
  assert.throws(() => parseEnv({ ...base, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_URL: 'https://nope' }), /CLOUDINARY_URL/);
});

test('end to end with Cloudinary as the active driver: seed, upload, analyze, download, cleanup', async () => {
  const fake = fakeCloudinary();
  setStorage(cloudStorage(fake));
  await resetDb(); // seeding uploads the demo evidence through the storage layer
  const { rows } = await pool.query("SELECT kind, storage, stored_path, public_id FROM claim_files WHERE claim_id='CLM-1042' ORDER BY kind, id");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.storage === 'cloudinary' && r.stored_path === null && r.public_id), 'seeded files live in Cloudinary only');

  const mcp = mockMcp();
  const built = createApp({ mcp });
  const headers = await login(request, built.app);

  // the agents read the accident report out of Cloudinary and still catch the date mismatch
  await analyzeAndWait(request, built.app, built.services, headers);
  const detail = (await request(built.app).get('/api/claims/CLM-1042').set(headers)).body;
  assert.equal(detail.analysis.state, 'awaiting_review');
  assert.deepEqual(detail.analysis.decision.inconsistencies[0].evidence.map((e) => e.value), ['March 12, 2026', 'March 15, 2026']);

  // download goes through OUR authenticated route and streams the bytes
  const photo = detail.files.find((f) => f.kind === 'image');
  assert.equal((await request(built.app).get(photo.url)).status, 401);
  const dl = await request(built.app).get(photo.url).set(headers);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers['content-type'], 'image/jpeg');
  assert.ok(dl.body.length > 100);

  // new claim through the API: files go to Cloudinary, nothing is left on local disk
  const jpg = fs.readFileSync(path.join(dataDir, 'images', 'CLM-1042_front_bumper.jpg'));
  const created = await request(built.app).post('/api/claims').set(headers)
    .field('customerName', 'John Doe').field('vehicle', '2024 Fictional Motors Sedan')
    .attach('images', jpg, { filename: 'a.jpg', contentType: 'image/jpeg' })
    .attach('report', Buffer.from('The accident occurred on March 15, 2026.'), { filename: 'r.txt', contentType: 'text/plain' });
  assert.equal(created.status, 201);
  assert.equal(fs.existsSync(path.join(dataDir, 'claims', created.body.id)), false);
  const stored = (await pool.query('SELECT storage FROM claim_files WHERE claim_id=$1', [created.body.id])).rows;
  assert.deepEqual(stored.map((r) => r.storage), ['cloudinary', 'cloudinary']);
  assert.equal(fs.readdirSync(path.join(dataDir, 'tmp')).length, 0, 'multer temp files are cleaned up');

  // a failure mid-upload must not leave orphans in Cloudinary or a half-created claim
  const flaky = fakeCloudinary({ failUploadOn: 2 });
  setStorage(cloudStorage(flaky));
  const before = (await pool.query('SELECT count(*)::int n FROM claims')).rows[0].n;
  const failed = await request(built.app).post('/api/claims').set(headers)
    .field('customerName', 'John Doe').field('vehicle', '2024 Fictional Motors Sedan')
    .attach('images', jpg, { filename: 'a.jpg', contentType: 'image/jpeg' })
    .attach('report', Buffer.from('x'), { filename: 'r.txt', contentType: 'text/plain' });
  assert.ok(failed.status >= 500);
  assert.equal((await pool.query('SELECT count(*)::int n FROM claims')).rows[0].n, before);
  assert.equal(flaky.store.size, 0, 'the first file that did upload was cleaned up');
  assert.equal(fs.readdirSync(path.join(dataDir, 'tmp')).length, 0);
  await built.shutdown();
});
