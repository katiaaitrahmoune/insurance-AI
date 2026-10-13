export const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

// Typed error shape agreed in Seam 3: { code: NOT_FOUND | INVALID_STATUS | INTERNAL, message }
export const fail = (code, message) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
});

export async function logCall(pool, { tool, caller, args, result, success }) {
  try {
    await pool.query(
      'INSERT INTO tool_call_log(tool, caller, arguments, result, ok) VALUES ($1,$2,$3,$4,$5)',
      [tool, caller, JSON.stringify(args ?? {}), JSON.stringify(result ?? null), success],
    );
  } catch (err) {
    // Logging must never mask the tool outcome, but never swallow it silently either.
    console.error('tool_call_log write failed:', err.message);
  }
}
