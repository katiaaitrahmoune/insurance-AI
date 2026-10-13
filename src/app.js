import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './env.js';
import { logger } from './config/logger.js';
import { buildRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { createMcpClients } from './services/mcpClient.service.js';
import { createAgentRunner } from './services/agents/index.js';
import { createEventsService } from './services/events.service.js';
import { createAnalysisService } from './services/analysis.service.js';
import { createReviewService } from './services/review.service.js';
import { createChatService } from './services/chat.service.js';
import { memoryService } from './services/memory.service.js';
import { health } from './controllers/misc.controller.js';
import { docsRouter } from './config/docs.js';

/**
 * App factory. `mcp` and `agents` can be injected so tests can mock the MCP clients and assert
 * on the guardrail (analysis never calls update_claim; review calls it exactly once).
 */
export function createApp({ mcp, agents: agentsOverride } = {}) {
  const clients =
    mcp ?? createMcpClients({ url: env.MCP_URL, graphToken: env.MCP_GRAPH_TOKEN, reviewToken: env.MCP_REVIEW_TOKEN });

  const events = createEventsService();
  const agents =
    agentsOverride ??
    createAgentRunner({ mode: env.AGENT_MODE, graphMcp: clients.graph, memory: memoryService, delayMs: env.AGENT_STEP_DELAY_MS });

  // Wiring IS the guardrail: only `review` receives the update_claim-capable client.
  const analysis = createAnalysisService({ agents, events, logger });
  const review = createReviewService({ mcpReview: clients.review, agents, memory: memoryService, logger });
  const chat = createChatService({ analysis });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/api/health' } }));
  // Mounted before helmet: Swagger UI needs inline scripts that helmet's default CSP would block.
  if (env.ENABLE_DOCS) app.use('/api', docsRouter());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // frontend lives on another origin
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.resolve('public')));

  app.get('/health', health);
  app.use('/api', apiLimiter, buildRouter({ analysis, review, events, chat }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, services: { analysis, review, events, agents }, async shutdown() { events.closeAll(); await analysis.drain(); } };
}
