import { z } from 'zod';
import { ok, fail, logCall } from './common.js';

export const GET_POLICY = 'get_policy';

/** get_policy(policy_id) -> { id, name, filename, coverage_summary }. Read-only. */
export function registerGetPolicy(server, { pool, caller }) {
  server.registerTool(
    GET_POLICY,
    {
      title: 'Get policy',
      description:
        'Read-only. Returns the policy record (id, name, filename, coverage_summary) for a policy id. ' +
        'Clause text lives in the vector store, not here.',
      inputSchema: { policy_id: z.string().min(1).max(64) },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        filename: z.string(),
        coverage_summary: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ policy_id }) => {
      const args = { policy_id };
      try {
        const { rows } = await pool.query(
          'SELECT id, name, filename, coverage_summary FROM policies WHERE id = $1',
          [policy_id],
        );
        if (!rows.length) {
          const err = { code: 'NOT_FOUND', message: `Policy ${policy_id} not found` };
          await logCall(pool, { tool: GET_POLICY, caller, args, result: err, success: false });
          return fail(err.code, err.message);
        }
        await logCall(pool, { tool: GET_POLICY, caller, args, result: rows[0], success: true });
        return ok(rows[0]);
      } catch (e) {
        await logCall(pool, { tool: GET_POLICY, caller, args, result: { message: e.message }, success: false });
        return fail('INTERNAL', 'Policy lookup failed');
      }
    },
  );
}
