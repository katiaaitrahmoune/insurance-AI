import { z } from 'zod';
import { INCIDENT_TYPES, PRIORITIES, STAGES, CLAIM_STATUSES } from '../utils/constants.js';
import { snakeKeys, emptyToUndefined } from './common.js';

const opt = (schema) => z.preprocess(emptyToUndefined, schema.optional());

export const createClaimBody = z.preprocess(
  snakeKeys,
  z.object({
    customer_name: z.string({ error: 'customer_name is required' }).trim().min(1, 'customer_name is required').max(120),
    vehicle: z.string({ error: 'vehicle is required' }).trim().min(1, 'vehicle is required').max(160),
    description: z.string().trim().max(5000).default(''),
    policy_id: opt(z.string().trim().max(64)),
    priority: opt(z.enum(PRIORITIES)),
    incident_type: opt(z.enum(INCIDENT_TYPES)),
    estimated_amount: opt(z.coerce.number().nonnegative().max(10_000_000)),
  }),
);

export const listClaimsQuery = z.preprocess(
  snakeKeys,
  z.object({
    q: opt(z.string().trim().max(100)),
    stage: opt(z.enum([...STAGES, 'all'])),
    tab: opt(z.enum([...STAGES, 'all'])),
    priority: opt(z.enum([...PRIORITIES, 'all'])),
    status: opt(z.enum([...CLAIM_STATUSES, 'all'])),
    incident_type: opt(z.enum([...INCIDENT_TYPES, 'all'])),
    sort: z.enum(['created_at', 'updated_at', 'priority', 'amount']).default('created_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  }),
);
