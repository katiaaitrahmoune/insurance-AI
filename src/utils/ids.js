import { randomUUID } from 'node:crypto';
export const uuid = () => randomUUID();
export const shortId = (id) => String(id).replace(/-/g, '').slice(0, 8);
