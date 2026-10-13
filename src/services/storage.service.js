import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { v2 as cloudinaryLib } from 'cloudinary';
import { env } from '../env.js';
import { uuid } from '../utils/ids.js';
import { notFound } from '../utils/errors.js';

/**
 * File storage with two interchangeable drivers behind one interface:
 *
 *   put({ claimId, srcPath, filename, mimeType, kind, keepSource }) -> columns for claim_files
 *   open(row)   -> { stream, size? }     (used by the download route; auth stays on OUR API)
 *   read(row)   -> Buffer                (used by the agents to read the accident report)
 *   remove(row) -> void
 *
 * local      files under DATA_DIR/claims/<claimId>/, DB stores a path relative to DATA_DIR.
 * cloudinary uploaded with type "authenticated": there is NO public URL. The backend generates a
 *            short-lived signed URL server-side and streams the bytes to the already-authenticated user.
 */
const isImage = (mime) => mime.startsWith('image/');
const rtypeFor = (mime) => (isImage(mime) ? 'image' : 'raw'); // PDFs / text are "raw" assets

export function createStorage({ driver, dataDir, cloudinary = null, folder = 'insuralens', fetchImpl = globalThis.fetch }) {
  const root = path.resolve(dataDir);

  const resolveLocal = (row) => {
    if (path.isAbsolute(row.stored_path)) return row.stored_path; // legacy rows written by older builds
    const abs = path.resolve(root, row.stored_path);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw notFound('File not found'); // no traversal
    return abs;
  };

  const signedUrl = (row) =>
    cloudinary.url(row.public_id, { resource_type: row.resource_type, type: 'authenticated', sign_url: true, secure: true });

  async function fetchRemote(row) {
    const res = await fetchImpl(signedUrl(row));
    if (!res.ok) throw notFound(`File not available from storage (${res.status})`);
    return res;
  }

  return {
    driver,

    async put({ claimId, srcPath, filename, mimeType, kind, keepSource = false }) {
      if (driver === 'cloudinary') {
        const resource_type = rtypeFor(mimeType);
        const ext = path.extname(filename).toLowerCase();
        // raw assets keep their extension in the public_id; images do not
        const publicId = `${uuid()}${resource_type === 'raw' ? ext : ''}`;
        const res = await cloudinary.uploader.upload(srcPath, {
          resource_type,
          type: 'authenticated',
          folder: `${folder}/claims/${claimId}`,
          public_id: publicId,
          overwrite: false,
          use_filename: false,
        });
        if (!keepSource) await fsp.rm(srcPath, { force: true });
        return { storage: 'cloudinary', stored_path: null, public_id: res.public_id, resource_type: res.resource_type ?? resource_type };
      }

      // local
      if (keepSource) {
        const abs = path.resolve(srcPath);
        if (!abs.startsWith(root + path.sep)) throw new Error('keepSource files must live inside DATA_DIR');
        return { storage: 'local', stored_path: path.relative(root, abs).split(path.sep).join('/'), public_id: null, resource_type: null };
      }
      const dir = path.join(root, 'claims', claimId);
      await fsp.mkdir(dir, { recursive: true });
      const dest = path.join(dir, path.basename(srcPath)); // server-generated name, never user-controlled
      await fsp.rename(srcPath, dest).catch(async () => { await fsp.copyFile(srcPath, dest); await fsp.rm(srcPath, { force: true }); });
      return { storage: 'local', stored_path: path.relative(root, dest).split(path.sep).join('/'), public_id: null, resource_type: null };
    },

    async open(row) {
      if (row.storage === 'cloudinary') {
        const res = await fetchRemote(row);
        return { stream: Readable.fromWeb(res.body), size: Number(res.headers.get('content-length')) || undefined };
      }
      const abs = resolveLocal(row);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) throw notFound('File is no longer on disk');
      return { stream: fs.createReadStream(abs), size: st.size };
    },

    async read(row) {
      if (row.storage === 'cloudinary') return Buffer.from(await (await fetchRemote(row)).arrayBuffer());
      return fsp.readFile(resolveLocal(row));
    },

    async remove(row) {
      if (row.storage === 'cloudinary') {
        await cloudinary.uploader.destroy(row.public_id, { resource_type: row.resource_type, type: 'authenticated', invalidate: true });
        return;
      }
      await fsp.rm(resolveLocal(row), { force: true });
    },
  };
}

function configuredCloudinary() {
  // CLOUDINARY_URL is read by the SDK from the environment; otherwise use the three discrete vars.
  if (!env.CLOUDINARY_URL) {
    cloudinaryLib.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  }
  cloudinaryLib.config({ secure: true });
  return cloudinaryLib;
}

// Process-wide instance (swappable in tests).
export let storage = createStorage({
  driver: env.STORAGE_DRIVER,
  dataDir: env.DATA_DIR,
  cloudinary: env.STORAGE_DRIVER === 'cloudinary' ? configuredCloudinary() : null,
  folder: env.CLOUDINARY_FOLDER,
});
export const setStorage = (s) => { storage = s; };
