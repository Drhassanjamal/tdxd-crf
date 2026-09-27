import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, PROJECT_ROOT } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { api } from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      hsts: env.COOKIE_SECURE,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          // Only force HTTPS sub-resources when the app is actually served over HTTPS
          upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
        },
      },
    }),
  );
  // Log method, path (UUIDs only — no patient data in URLs), status and time. Bodies are never logged.
  if (env.NODE_ENV !== 'test') app.use(morgan(':method :url :status :response-time ms'));
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/integrations/whatsapp')) (req as any).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));

  // Production: serve the built frontend from the same origin
  const dist = path.join(PROJECT_ROOT, 'frontend', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
