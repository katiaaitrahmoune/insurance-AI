import { appendEvent, latestAnalysis } from '../models/analysis.model.js';

const HEARTBEAT_MS = 15_000;

/**
 * Seam 2 — progress events. Persisted per analysis run (so a refresh can replay them) and fanned
 * out to live Server-Sent-Events subscribers.
 *
 * Every event carries `analysis_id` and `seq` (its index within that run). Sequence numbers restart
 * for each run, so de-duplication is tracked per (subscriber, analysis_id): replay + live never
 * duplicate, and a new run (after a failure or "request more information") is never swallowed.
 * The SSE `id:` is "<analysis_id>-<seq>", which makes Last-Event-ID resume work within a run.
 */
export function createEventsService() {
  const subscribers = new Map(); // claimId -> Set<{ res, analysisId, lastSeq }>

  function deliver(sub, evt) {
    if (sub.analysisId !== evt.analysis_id) {
      sub.analysisId = evt.analysis_id; // a different run: start counting from scratch
      sub.lastSeq = -1;
    }
    if (evt.seq <= sub.lastSeq) return;
    sub.res.write(`id: ${evt.analysis_id}-${evt.seq}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt)}\n\n`);
    sub.lastSeq = evt.seq;
  }

  async function publish(analysisId, claimId, event) {
    const base = { claim_id: claimId, analysis_id: analysisId, ...event, ts: new Date().toISOString() };
    const seq = await appendEvent(analysisId, base);
    const full = { ...base, seq };
    for (const sub of subscribers.get(claimId) ?? []) deliver(sub, full);
    return full;
  }

  async function subscribe(claimId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const sub = { res, analysisId: null, lastSeq: -1 };
    if (!subscribers.has(claimId)) subscribers.set(claimId, new Set());
    subscribers.get(claimId).add(sub); // register first so nothing published during replay is lost

    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(beat);
      subscribers.get(claimId)?.delete(sub);
    });

    const analysis = await latestAnalysis(claimId);
    if (!analysis) return;
    // A live event from a newer run may already have arrived while we were querying: don't replay stale history.
    if (sub.analysisId !== null && analysis.id < sub.analysisId) return;

    const [lastRun, lastSeq] = String(req.headers['last-event-id'] ?? '').split('-').map((n) => Number.parseInt(n, 10));
    if (lastRun === analysis.id && Number.isInteger(lastSeq)) {
      sub.analysisId = analysis.id;
      sub.lastSeq = lastSeq; // resume mid-run
    }
    (analysis.events ?? []).forEach((e, seq) => deliver(sub, { ...e, analysis_id: analysis.id, seq }));
  }

  function closeAll() {
    for (const set of subscribers.values()) for (const s of set) s.res.end();
    subscribers.clear();
  }

  return { publish, subscribe, closeAll };
}
