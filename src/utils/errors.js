export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT', details) => new ApiError(409, code, message, details);
export const unprocessable = (message, details) => new ApiError(422, 'VALIDATION_ERROR', message, details);
export const badGateway = (message, code = 'UPSTREAM_ERROR', details) => new ApiError(502, code, message, details);
