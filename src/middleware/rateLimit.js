import rateLimit from 'express-rate-limit';
import { env } from '../env.js';

const make = (windowMs, limit, code) =>
  rateLimit({
    windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.isTest,
    handler: (_req, res) => res.status(429).json({ error: { code, message: 'Too many requests. Please slow down and try again shortly.' } }),
  });

export const apiLimiter = make(60_000, 600, 'RATE_LIMITED');
export const loginLimiter = make(15 * 60_000, 30, 'LOGIN_RATE_LIMITED');
export const analyzeLimiter = make(60_000, 20, 'RATE_LIMITED');
