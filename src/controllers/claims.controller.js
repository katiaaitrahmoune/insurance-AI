import * as claimService from '../services/claim.service.js';
import { notFound, unprocessable } from '../utils/errors.js';
import { getClaimRow } from '../models/claim.model.js';
import { storage } from '../services/storage.service.js';
import { pipeline } from 'node:stream/promises';
import { listEveryFile, getFile as getFileRow } from '../models/file.model.js';
import { serializeFile } from '../utils/serializers.js';
import { extractTextFromBuffer } from '../utils/text.js';
import { query } from '../config/db.js';

export const list = async (req, res) =>
  res.json(await claimService.listClaims(req.validated.query));

export const create = async (req, res) =>
  res.status(201).json(
    await claimService.createClaim(req.validated.body, req.files, req.user)
  );

export const get = async (req, res) =>
  res.json(await claimService.getClaimDetail(req.params.id));

export const addEvidence = async (req, res) =>
  res.status(201).json({
    files: await claimService.addEvidence(req.params.id, req.files, req.user)
  });

// Download a claim file.
export const downloadFile = async (req, res) => {
  const f = await claimService.getFileForDownload(
    req.params.id,
    req.params.fileId
  );

  const inline =
    f.mime_type.startsWith('image/') ||
    f.mime_type === 'application/pdf' ||
    f.mime_type === 'text/plain';

  const { stream, size } = await storage.open(f);

  res.type(f.mime_type);

  if (size !== undefined) {
    res.setHeader('Content-Length', size);
  }

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`
  );

  await pipeline(stream, res).catch(() => {});
};

// Stream claim events.
export const streamFactory = (events) => async (req, res) => {
  if (!(await getClaimRow(req.params.id))) {
    throw notFound(`Claim ${req.params.id} not found`);
  }

  await events.subscribe(req.params.id, req, res);
};

// Start claim analysis.
export const analyzeFactory = (analysis) => async (req, res) =>
  res.status(202).json(await analysis.start(req.params.id, req.user));

// Review a claim.
export const reviewFactory = (review) => async (req, res) => {
  const { action, claim_id } = req.validated.body;

  if (claim_id && claim_id !== req.params.id) {
    throw unprocessable('claim_id in the body does not match the URL');
  }

  res.json(
    await review.review({
      claimId: req.params.id,
      action,
      user: req.user
    })
  );
};

// GET /api/files
export const listAllFilesHandler = async (_req, res) => {
  res.json({
    items: (await listEveryFile()).map(serializeFile)
  });
};

// GET /api/files/:fileId/content?format=base64|text
export const fileContent = async (req, res) => {
  const f = await getFileRow(req.params.fileId);

  if (!f) throw notFound('File not found');

  const bytes = await storage.read(f);

  const base = {
    id: f.id,
    claimId: f.claim_id,
    kind: f.kind,
    name: f.original_name,
    mimeType: f.mime_type,
    sizeBytes: bytes.length
  };

  if (req.validated.query.format === 'text') {
    if (
      !(
        f.mime_type?.startsWith('text/') ||
        f.mime_type === 'application/pdf'
      )
    ) {
      throw unprocessable(
        'Text is only available for PDF and text files'
      );
    }

    return res.json({
      ...base,
      encoding: 'text',
      content: await extractTextFromBuffer(bytes, f.mime_type)
    });
  }

  return res.json({
    ...base,
    encoding: 'base64',
    content: bytes.toString('base64')
  });
};

// GET /api/files/:fileId/image
export const getFileImage = async (req, res) => {
  const f = await getFileRow(req.params.fileId);

  if (!f) throw notFound('File not found');

  if (!f.mime_type?.startsWith('image/')) {
    throw unprocessable('The requested file is not an image');
  }

  const { stream, size } = await storage.open(f);

  res.type(f.mime_type);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');

  if (size !== undefined) {
    res.setHeader('Content-Length', size);
  }

  await pipeline(stream, res);
};

const COVERAGE = ['covered', 'not_covered', 'partial', 'unclear'];

const STATES = [
  'not_started',
  'running',
  'awaiting_review',
  'reviewing',
  'reviewed',
  'failed'
];

const pick = (b, name) =>
  b[name] ?? b[name[0].toUpperCase() + name.slice(1)];

// Update claim analysis results.
export const updateAnalysis = async (req, res) => {
  const b = req.body ?? {};
  const sets = [];
  const values = [];

  const add = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  // Estimated amount.
  const amount = pick(b, 'estimatedAmount');

  if (amount !== undefined) {
    const n = amount === null ? null : Number(amount);

    if (
      n !== null &&
      (!Number.isFinite(n) || n < 0 || n > 9999999999.99)
    ) {
      throw unprocessable('estimatedAmount must be a number >= 0');
    }

    add('estimated_amount', n);
  }

  // Damage summary.
  const summary = pick(b, 'damageSummary');

  if (summary !== undefined) {
    if (summary !== null && typeof summary !== 'string') {
      throw unprocessable('damageSummary must be a string');
    }

    add('damage_summary', summary);
  }

  // Coverage status.
  const coverage = pick(b, 'coverageStatus');

  if (coverage !== undefined) {
    if (coverage !== null && !COVERAGE.includes(coverage)) {
      throw unprocessable(
        `coverageStatus must be one of: ${COVERAGE.join(', ')}`
      );
    }

    add('coverage_status', coverage);
  }

  // Inconsistency flag.
  const flag = pick(b, 'inconsistencyFlag');

  if (flag !== undefined) {
    if (typeof flag !== 'boolean') {
      throw unprocessable('inconsistencyFlag must be true or false');
    }

    add('inconsistency_flag', flag);
  }

  // Claim assessment.
  const assessment = pick(b, 'ClaimAssessment');

  if (assessment !== undefined) {
    if (assessment !== null && typeof assessment !== 'string') {
      throw unprocessable('ClaimAssessment must be a string');
    }

    add('"ClaimAssessment"', assessment);
  }

  // Inconsistency details.
  const inconsistencyDetails = pick(b, 'inconsistencyDetails');

  if (inconsistencyDetails !== undefined) {
    if (
      inconsistencyDetails !== null &&
      typeof inconsistencyDetails !== 'string'
    ) {
      throw unprocessable('inconsistencyDetails must be a string');
    }

    add('"inconsistencyDetails"', inconsistencyDetails);
  }

  // Analysis state.
  const state = pick(b, 'analysisState') ?? 'awaiting_review';

  if (!STATES.includes(state)) {
    throw unprocessable(
      `analysisState must be one of: ${STATES.join(', ')}`
    );
  }

  add('analysis_state', state);

  // Update the claims table.
  values.push(req.params.id);

  const { rows } = await query(
    `UPDATE public.claims
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );

  if (!rows[0]) {
    throw notFound(`Claim ${req.params.id} not found`);
  }

  // Save decision in claim_analyses when provided.
  const decision = pick(b, 'decision');

  if (decision !== undefined) {
    if (decision !== null && typeof decision !== 'string') {
      throw unprocessable('decision must be a string');
    }

    await query(
      `UPDATE public.claim_analyses
          SET decision_jsonb = to_jsonb($1::text)
        WHERE claim_id = $2`,
      [decision, req.params.id]
    );
  }

  res.json(rows[0]);
};