import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../env.js';
import { uuid } from '../utils/ids.js';
import { unprocessable } from '../utils/errors.js';

const tmpDir = path.resolve(env.DATA_DIR, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REPORT_TYPES = new Set(['application/pdf', 'text/plain']);

const fileFilter = (_req, file, cb) => {
  const isImage = ['images', 'photos'].includes(file.fieldname);
  const isReport = ['report', 'accident_report'].includes(file.fieldname);
  const isPolicy = file.fieldname === 'policy';
  if (isImage && IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
  if (isReport && REPORT_TYPES.has(file.mimetype)) return cb(null, true);
  if (isPolicy && file.mimetype === 'application/pdf') return cb(null, true);
  cb(unprocessable(`"${file.originalname}" is not an accepted file for field "${file.fieldname}" (images: JPEG/PNG/WebP; report: PDF/TXT; policy: PDF)`));
};

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase().slice(0, 8).replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 10, fields: 20 },
  fileFilter,
});

export const claimUpload = upload.fields([
  { name: 'images', maxCount: 6 },
  { name: 'photos', maxCount: 6 },
  { name: 'report', maxCount: 1 },
  { name: 'accident_report', maxCount: 1 },
  { name: 'policy', maxCount: 1 },
]);
