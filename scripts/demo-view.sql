-- Demo-day database view: shows the human action landing in the database.
SELECT id, customer_name, status, coverage_status, inconsistency_flag, damage_summary, decided_at FROM claims WHERE id = 'CLM-1042';
-- The auditable MCP tool call behind it:
SELECT id, tool, caller, arguments, result->>'new_status' AS new_status, ok, created_at FROM tool_call_log ORDER BY id DESC LIMIT 5;
-- Long-term memory written after the review:
SELECT id, claim_id, memory_type, content, created_at FROM claim_memories ORDER BY id DESC LIMIT 10;
