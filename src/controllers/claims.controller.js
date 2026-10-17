import * as claimService from '../services/claim.service.js';
import { notFound, unprocessable } from '../utils/errors.js';
import { getClaimRow } from '../models/claim.model.js';
import { storage } from '../services/storage.service.js';
import { pipeline } from 'node:stream/promises';
import { listEveryFile } from '../models/file.model.js';
import { serializeFile } from '../utils/serializers.js';
import { getFile as getFileRow } from '../models/file.model.js';
import { extractTextFromBuffer } from '../utils/text.js';

export const list = async (req, res) => res.json(await claimService.listClaims(req.validated.query));
export const create = async (req, res) => res.status(201).json(await claimService.createClaim(req.validated.body, req.files, req.user));
export const get = async (req, res) => res.json(await claimService.getClaimDetail(req.params.id));
export const addEvidence = async (req, res) =>
  res.status(201).json({ files: await claimService.addEvidence(req.params.id, req.files, req.user) });

export const downloadFile = async (req, res) => {
  const f = await claimService.getFileForDownload(req.params.id, req.params.fileId);
  const inline = f.mime_type.startsWith('image/') || f.mime_type === 'application/pdf' || f.mime_type === 'text/plain';
  const { stream, size } = await storage.open(f); // throws 404 before any header is sent
  res.type(f.mime_type);
  if (size) res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  await pipeline(stream, res).catch(() => {}); // client aborted: nothing to report
};

export const streamFactory = (events) => async (req, res) => {
  if (!(await getClaimRow(req.params.id))) throw notFound(`Claim ${req.params.id} not found`);
  await events.subscribe(req.params.id, req, res);
};

export const analyzeFactory = (analysis) => async (req, res) => res.status(202).json(await analysis.start(req.params.id, req.user));

export const reviewFactory = (review) => async (req, res) => {
  const { action, claim_id } = req.validated.body;
  if (claim_id && claim_id !== req.params.id) {
    throw unprocessable('claim_id in the body does not match the URL');
  }
  res.json(await review.review({ claimId: req.params.id, action, user: req.user }));
};
// GET /api/files
export const listAllFilesHandler = async (_req, res) => {
  res.json({ items: (await listEveryFile()).map(serializeFile) });
};
// GET /api/files/:fileId/content?format=base64|text
export const fileContent = async (req, res) => {
  const f = await getFileRow(req.params.fileId);
  if (!f) throw notFound('File not found');
  const bytes = await storage.read(f);
  const base = { id: f.id, claimId: f.claim_id, kind: f.kind, name: f.original_name, mimeType: f.mime_type, sizeBytes: bytes.length };
  if (req.validated.query.format === 'text') {
    if (!(f.mime_type.startsWith('text/') || f.mime_type === 'application/pdf')) {
      throw unprocessable('Text is only available for PDF and text files');
    }
    return res.json({ ...base, encoding: 'text', content: await extractTextFromBuffer(bytes, f.mime_type) });
  }
  res.json({ ...base, encoding: 'base64', content: bytes.toString('base64') });
};