import { z } from 'zod';
import { INCIDENT_TYPES, PRIORITIES } from '../utils/constants.js';
import { snakeKeys, emptyToUndefined } from './common.js';

const date = z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
export const analyticsQuery = z.preprocess(
  snakeKeys,
  z.object({
    from: date,
    to: date,
    incident_type: z.preprocess(emptyToUndefined, z.enum([...INCIDENT_TYPES, 'all']).optional()),
    priority: z.preprocess(emptyToUndefined, z.enum([...PRIORITIES, 'all']).optional()),
  }),
);
