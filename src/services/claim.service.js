import fs from 'node:fs/promises';
import path from 'node:path';
import { withTransaction } from '../config/db.js';
import * as claimModel from '../models/claim.model.js';
import * as fileModel from '../models/file.model.js';
import { latestAnalysis } from '../models/analysis.model.js';
import { getPolicyRow } from '../models/policy.model.js';
import { logAudit } from '../models/audit.model.js';
import { DEFAULT_POLICY_ID } from '../utils/constants.js';
import { notFound, unprocessable, conflict } from '../utils/errors.js';
import { uuid } from '../utils/ids.js';
import { sniffFileType } from '../utils/text.js';
import { storage } from './storage.service.js';
import { serializeClaim, serializeFile, serializeAnalysis } from '../utils/serializers.js';

const FIELD_KIND = { images: 'image', photos: 'image', report: 'report', accident_report: 'report', policy: 'policy' };

const flatten = (files = {}) =>
  Object.entries(files).flatMap(([field, list]) => list.map((f) => ({ ...f, kind: FIELD_KIND[field] ?? 'other' })));

/** Verify real file types (magic bytes), not just the client-declared mimetype. */
async function verifyUploads(files) {
  for (const f of files) {
    const real = await sniffFileType(f.path);
    const ok =
      f.kind === 'image' ? real.startsWith('image/') :
      f.kind === 'report' ? real === 'application/pdf' || (real === 'text/plain' && /\.txt$/i.test(f.originalname)) :
      f.kind === 'policy' ? real === 'application/pdf' : true;
    if (!ok) throw unprocessable(`"${f.originalname}" is not a valid ${f.kind} file`);
    f.verifiedMime = real === 'text/plain' ? 'text/plain' : real;
  }
}

async function storeFiles(db, claimId, files, ledger) {
  const rows = [];
  for (const f of files) {
    const put = await storage.put({
      claimId, srcPath: f.path, filename: f.originalname, mimeType: f.verifiedMime, kind: f.kind,
    });
    ledger.push(put); // remembered so a later failure can clean up already-stored files
    rows.push(await fileModel.insertFile(db, {
      claim_id: claimId, kind: f.kind, original_name: f.originalname.slice(0, 200),
      mime_type: f.verifiedMime, size_bytes: f.size, ...put,
    }));
  }
  return rows;
}

async function cleanup(ledger, tmpFiles) {
  await Promise.allSettled([...ledger.map((p) => storage.remove(p)), ...tmpFiles.map((f) => fs.rm(f.path, { force: true }))]);
}

export async function createClaim(body, uploads, user) {
  const files = flatten(uploads);
  const ledger = [];
  try {
    await verifyUploads(files);
    const policyId = body.policy_id ?? DEFAULT_POLICY_ID;
    if (!(await getPolicyRow(policyId))) throw unprocessable(`Unknown policy_id "${policyId}"`);

    const result = await withTransaction(async (db) => {
      const id = await claimModel.nextClaimId(db);
      const claim = await claimModel.insertClaim(db, { ...body, id, policy_id: policyId, created_by: user?.id });
      const stored = await storeFiles(db, id, files, ledger);
      await logAudit(id, user?.email ?? 'system', 'claim_created', { files: stored.length }, db);
      return { claim, stored };
    });
    return { ...serializeClaim(result.claim), files: result.stored.map(serializeFile) };
  } catch (err) {
    await cleanup(ledger, files);
    throw err;
  }
}

export async function addEvidence(claimId, uploads, user) {
  const files = flatten(uploads);
  const ledger = [];
  try {
    if (!files.length) throw unprocessable('No files were uploaded');
    const claim = await claimModel.getClaimRow(claimId);
    if (!claim) throw notFound(`Claim ${claimId} not found`);
    if (['running', 'reviewing'].includes(claim.analysis_state)) {
      throw conflict('Evidence cannot be added while analysis or review is in progress', 'CLAIM_BUSY');
    }
    await verifyUploads(files);
    const stored = await withTransaction(async (db) => {
      const rows = await storeFiles(db, claimId, files, ledger);
      await logAudit(claimId, user?.email ?? 'system', 'evidence_added', { files: rows.length }, db);
      return rows;
    });
    return stored.map(serializeFile);
  } catch (err) {
    await cleanup(ledger, files);
    throw err;
  }
}

export async function listClaims(filters) {
  const { rows, total } = await claimModel.listClaims(filters);
  const counts = await claimModel.countsBy('stage');
  return {
    items: rows.map(serializeClaim),
    page: filters.page,
    pageSize: filters.page_size,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.page_size)),
    counts: { all: Object.values(counts).reduce((a, b) => a + b, 0), ...counts },
  };
}

export async function getClaimDetail(id) {
  const claim = await claimModel.getClaimRow(id);
  if (!claim) throw notFound(`Claim ${id} not found`);
  const [files, analysis] = await Promise.all([fileModel.listFiles(id), latestAnalysis(id)]);
  return { ...serializeClaim(claim), files: files.map(serializeFile), analysis: serializeAnalysis(analysis) };
}

export async function getFileForDownload(claimId, fileId) {
  const f = await fileModel.getFile(fileId);
  if (!f || f.claim_id !== claimId) throw notFound('File not found');
  return f;
}
