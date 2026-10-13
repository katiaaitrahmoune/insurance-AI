import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/openapi.yaml');

/** Swagger UI at /api/docs and the raw spec at /api/openapi.json (served from docs/openapi.yaml). */
export function docsRouter() {
  const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
  const r = Router();
  r.get('/openapi.json', (_req, res) => res.json(spec));
  r.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'InsuraLens API', swaggerOptions: { persistAuthorization: true } }));
  return r;
}
