import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  ENABLE_DOCS: bool.default(true), // Swagger UI at /api/docs

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  RUN_MIGRATIONS_ON_START: bool.default(true),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  ALLOW_DEMO_LOGIN: bool.default(true),
  DEMO_PASSWORD: z.string().default('demo123'),

  CORS_ORIGINS: z
    .string()
    .default('http://127.0.0.1:5173,http://localhost:5173,https://insura-lens.vercel.app'),

  // insuralens-mcp: two callers, two tokens -> structurally different tool sets
  MCP_URL: z.string().url().default('http://127.0.0.1:5100/mcp'),
  MCP_GRAPH_TOKEN: z.string().min(8),
  MCP_REVIEW_TOKEN: z.string().min(8),

  // AI Engineer integration point
  AGENT_MODE: z.enum(['fixture']).default('fixture'),
  AGENT_STEP_DELAY_MS: z.coerce.number().int().min(0).default(1200),
  GEMINI_API_KEY: z.string().optional().default(''),

  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  // File storage: local disk for dev/tests, Cloudinary for production hosts with ephemeral disks.
  DATA_DIR: z.string().default('./data'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15), // Cloudinary free plan caps files at 10 MB
  STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_URL: z.string().optional().default(''), // cloudinary://<key>:<secret>@<cloud>
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_FOLDER: z.string().default('insuralens'),
}).superRefine((v, ctx) => {
  if (v.STORAGE_DRIVER !== 'cloudinary') return;
  const hasUrl = v.CLOUDINARY_URL.startsWith('cloudinary://');
  const hasTriple = v.CLOUDINARY_CLOUD_NAME && v.CLOUDINARY_API_KEY && v.CLOUDINARY_API_SECRET;
  if (!hasUrl && !hasTriple) {
    ctx.addIssue({
      code: 'custom', path: ['CLOUDINARY_URL'],
      message: 'STORAGE_DRIVER=cloudinary needs CLOUDINARY_URL (cloudinary://key:secret@cloud) or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET',
    });
  }
});

export function parseEnv(raw) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}

export const env = parseEnv(process.env);
