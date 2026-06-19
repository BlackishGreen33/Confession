import { Hono } from 'hono';

import { buildHealthResponse } from './health-score';
import { adviceRoutes } from './routes/advice';
import { configRoutes } from './routes/config';
import { exportRoutes } from './routes/export';
import { monitoringRoutes } from './routes/monitoring';
import { scanRoutes } from './routes/scan';
import { vulnerabilityRoutes } from './routes/vulnerabilities';

const app = new Hono().basePath('/api');

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function allowedCorsOrigins(): Set<string> {
  const configured = process.env.CONFESSION_CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');
  return new Set(configured?.length ? configured : DEFAULT_CORS_ORIGINS);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  );
}

function requestUrl(requestUrl: string): URL {
  return new URL(requestUrl);
}

function isLoopbackRequest(requestUrlValue: string): boolean {
  try {
    return isLoopbackHostname(requestUrl(requestUrlValue).hostname);
  } catch {
    return false;
  }
}

function isPublicApiPath(requestUrlValue: string): boolean {
  try {
    return requestUrl(requestUrlValue).pathname === '/api/health';
  } catch {
    return false;
  }
}

function hasValidApiToken(authorization: string | undefined): boolean {
  const token = process.env.CONFESSION_API_TOKEN;
  if (!token) return false;
  return authorization === `Bearer ${token}`;
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowedOrigins = allowedCorsOrigins();

  if (origin) {
    if (!allowedOrigins.has(origin)) {
      return c.json({ error: 'CORS origin not allowed' }, 403);
    }

    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Expose-Headers', 'Content-Disposition, X-Confession-Sarif-Warning');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  const reqUrl = c.req.url;
  if (
    !isPublicApiPath(reqUrl) &&
    !isLoopbackRequest(reqUrl) &&
    !hasValidApiToken(c.req.header('Authorization'))
  ) {
    return c.json({ error: '未授權' }, 401);
  }

  return next();
});

app.get('/health', async (c) => {
  const rawWindowDays = c.req.query('windowDays');
  const parsedWindowDays = rawWindowDays ? Number(rawWindowDays) : Number.NaN;
  const riskWindowDays =
    parsedWindowDays === 7 || parsedWindowDays === 30 ? parsedWindowDays : 30;

  try {
    return c.json(await buildHealthResponse(new Date(), { riskWindowDays }));
  } catch {
    const now = new Date().toISOString();
    return c.json({
      status: 'down',
      evaluatedAt: now,
      score: {
        version: 'v2',
        value: 0,
        grade: 'D',
        components: {
          exposure: { value: 0, orb: 0, lev: 0 },
          remediation: { value: 0, mttrHours: 0, closureRate: 0 },
          quality: { value: 0, efficiency: 0, coverage: 0 },
          reliability: {
            value: 0,
            successRate: 0,
            fallbackRate: 0,
            workspaceP95Ms: 0,
          },
        },
        topFactors: [],
      },
      engine: {},
    });
  }
});
app.route('/config', configRoutes);
app.route('/advice', adviceRoutes);
app.route('/scan', scanRoutes);
app.route('/vulnerabilities', vulnerabilityRoutes);
app.route('/export', exportRoutes);
app.route('/monitoring', monitoringRoutes);

app.onError((err, c) => c.json({ error: err.message }, 500));

export { app };
export type AppType = typeof app;
