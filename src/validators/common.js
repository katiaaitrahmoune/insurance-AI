import { z } from 'zod';

const camelToSnake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Accept camelCase or snake_case keys from clients; schemas are written in snake_case. */
export const snakeKeys = (input) =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input).map(([k, v]) => [camelToSnake(k), v]))
    : input;

export const claimIdParam = z.object({ id: z.string().regex(/^CLM-\d{3,10}$/, 'Invalid claim id') });
export const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);
