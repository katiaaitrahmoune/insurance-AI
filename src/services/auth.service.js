import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { upsertUser, getUser } from '../models/user.model.js';
import { ApiError, unauthorized } from '../utils/errors.js';


const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const nameFromEmail = (email) =>
  email.split('@')[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || 'Claims Officer';

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

function issue(user) {
  const token = jwt.sign({ sub: String(user.id), email: user.email, name: user.name, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  return { token, user: publicUser(user) };
}

export async function login(email, password) {
  if (!env.ALLOW_DEMO_LOGIN) throw new ApiError(403, 'LOGIN_DISABLED', 'Password sign-in is disabled on this server');
  if (!same(password, env.DEMO_PASSWORD)) throw unauthorized('Incorrect email or password');
  return issue(await upsertUser(email, nameFromEmail(email)));
}

export async function demoLogin() {
  if (!env.ALLOW_DEMO_LOGIN) throw new ApiError(403, 'LOGIN_DISABLED', 'Demo sign-in is disabled on this server');
  return issue(await upsertUser('demo@insuralens.app', 'Demo Officer'));
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

export async function currentUser(id) {
  const u = await getUser(Number(id));
  if (!u) throw unauthorized('User no longer exists');
  return publicUser(u);
}
