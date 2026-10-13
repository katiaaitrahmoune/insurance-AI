import { z } from 'zod';

// Seam 4 — Review action payload (Frontend -> Backend). Unknown actions are rejected with 422.
export const reviewBody = z
  .object({
    claim_id: z.string().optional(),
    action: z.enum(['approve', 'request_info']),
  })
  .strict();
