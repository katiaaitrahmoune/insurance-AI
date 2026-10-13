import { z } from 'zod';
import { ok, fail, logCall } from './common.js';

export const UPDATE_CLAIM = 'update_claim';
export const ALLOWED_STATUSES = ['PENDING', 'APPROVED', 'MORE_INFO_REQUIRED'];

/**
 * update_claim(claim_id, status): the ONLY path by which claims.status changes.
 * Validates status, fails on unknown claim, idempotent for repeated identical calls, logs every call.
 */
export function registerUpdateClaim(server, { pool, caller }) {
  server.registerTool(
    UPDATE_CLAIM,
    {
      title: 'Update claim status',
      description:
        'Sets claims.status for one claim. Only ever invoked after an explicit human review action. ' +
        `Allowed statuses: ${ALLOWED_STATUSES.join(', ')}.`,
      // status is a plain string on purpose so an invalid value yields our typed INVALID_STATUS error
      inputSchema: { claim_id: z.string().min(1).max(64), status: z.string().min(1).max(64) },
      outputSchema: {
        claim_id: z.string(),
        old_status: z.string(),
        new_status: z.string(),
        updated_at: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ claim_id, status }) => {
      const args = { claim_id, status };
      if (!ALLOWED_STATUSES.includes(status)) {
        const err = { code: 'INVALID_STATUS', message: `status must be one of ${ALLOWED_STATUSES.join(', ')}` };
        await logCall(pool, { tool: UPDATE_CLAIM, caller, args, result: err, success: false });
        return fail(err.code, err.message);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT status FROM claims WHERE id = $1 FOR UPDATE', [claim_id]);
        if (!cur.rowCount) {
          await client.query('ROLLBACK');
          const err = { code: 'NOT_FOUND', message: `Claim ${claim_id} not found` };
          await logCall(pool, { tool: UPDATE_CLAIM, caller, args, result: err, success: false });
          return fail(err.code, err.message);
        }
        const old_status = cur.rows[0].status;
        // Declares this transaction as the sanctioned writer; the DB trigger rejects everyone else.
        await client.query("SELECT set_config('app.status_writer', 'update_claim_tool', true)");
        const upd =
          old_status === status
            ? await client.query('SELECT updated_at FROM claims WHERE id = $1', [claim_id]) // idempotent no-op
            : await client.query(
                `UPDATE claims
                    SET status = $2,
                        updated_at = now(),
                        decided_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE NULL END
                  WHERE id = $1
              RETURNING updated_at`,
                [claim_id, status],
              );
        await client.query('COMMIT');
        const result = { claim_id, old_status, new_status: status, updated_at: upd.rows[0].updated_at.toISOString() };
        await logCall(pool, { tool: UPDATE_CLAIM, caller, args, result, success: true });
        return ok(result);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        await logCall(pool, { tool: UPDATE_CLAIM, caller, args, result: { message: e.message }, success: false });
        return fail('INTERNAL', 'Claim update failed');
      } finally {
        client.release();
      }
    },
  );
}
