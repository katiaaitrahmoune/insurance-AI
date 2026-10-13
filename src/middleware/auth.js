import { verifyToken } from '../services/auth.service.js';
import { unauthorized } from '../utils/errors.js';

/**
 * Bearer-token auth. EventSource and <img> cannot send headers, so routes that need them
 * (SSE stream, file download) opt in to `?token=` via { allowQueryToken: true }.
 */
export const requireAuth = ({ allowQueryToken = false } = {}) => (req, _res, next) => {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token && allowQueryToken && typeof req.query.token === 'string') token = req.query.token;
  if (!token) return next(unauthorized());
  try {
    const p = verifyToken(token);
    req.user = { id: Number(p.sub), email: p.email, name: p.name, role: p.role };
    next();
  } catch (e) {
    next(e);
  }
};
