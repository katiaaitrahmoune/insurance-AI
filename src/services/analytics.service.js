import { pool } from '../config/db.js';

const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export async function getAnalytics(f) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.from) add('c.created_at >= ?::date', f.from);
  if (f.to) add("c.created_at < (?::date + 1)", f.to);
  if (f.incident_type && f.incident_type !== 'all') add('c.incident_type = ?', f.incident_type);
  if (f.priority && f.priority !== 'all') add('c.priority = ?', f.priority);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [summary, perDay, byIncident, byStage, byStatus, analysisDur] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE c.status = 'APPROVED')::int AS approved,
                       count(*) FILTER (WHERE c.stage = 'human_review')::int AS awaiting_review,
                       count(*) FILTER (WHERE c.inconsistency_flag)::int AS with_inconsistencies,
                       avg(extract(epoch FROM (c.decided_at - c.created_at)) / 3600) FILTER (WHERE c.decided_at IS NOT NULL) AS avg_hours_to_decision
                  FROM claims c ${w}`, params),
    pool.query(`SELECT c.created_at::date AS date, count(*)::int AS count FROM claims c ${w} GROUP BY 1 ORDER BY 1`, params),
    pool.query(`SELECT c.incident_type AS key, count(*)::int AS count FROM claims c ${w} GROUP BY 1 ORDER BY 2 DESC`, params),
    pool.query(`SELECT c.stage AS key, count(*)::int AS count FROM claims c ${w} GROUP BY 1`, params),
    pool.query(`SELECT c.status AS key, count(*)::int AS count FROM claims c ${w} GROUP BY 1`, params),
    pool.query(`SELECT avg(extract(epoch FROM (a.completed_at - a.started_at))) AS secs
                  FROM claim_analyses a JOIN claims c ON c.id = a.claim_id
                  ${w ? w + ' AND' : 'WHERE'} a.completed_at IS NOT NULL AND a.state <> 'failed'`, params),
  ]);
  const s = summary.rows[0];
  return {
    filters: { from: f.from ?? null, to: f.to ?? null, incidentType: f.incident_type ?? 'all', priority: f.priority ?? 'all' },
    summary: {
      totalClaims: s.total,
      approved: s.approved,
      awaitingReview: s.awaiting_review,
      inconsistencyRate: s.total ? round(s.with_inconsistencies / s.total, 3) : 0,
      avgHoursToDecision: round(s.avg_hours_to_decision),
      avgAnalysisSeconds: round(analysisDur.rows[0].secs),
    },
    claimsPerDay: perDay.rows,
    byIncidentType: byIncident.rows,
    byStage: byStage.rows,
    byStatus: byStatus.rows,
  };
}
