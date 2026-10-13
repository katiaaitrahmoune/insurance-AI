import multer from 'multer';
import { ApiError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

export const notFoundHandler = (req, _res, next) => next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));

// Every error leaves in the contract envelope: { error: { code, message, details } }
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side.';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'A file exceeds the maximum upload size.' : `Upload rejected: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_REQUEST'; message = 'Request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
  } else if (err.code === '42501') {
    // DB guard rejected a write to the protected status column. Must never happen in normal flow.
    status = 500; code = 'STATUS_GUARD'; message = 'A protected field cannot be changed this way.';
    logger.error({ err }, 'status guard tripped');
  } else {
    logger.error({ err, path: req.path }, 'unhandled error');
  }
  if (res.headersSent) return res.end();
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
};
