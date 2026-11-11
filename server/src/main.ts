import './common/env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { DATA_DIR, ensureDataDirs, ensureSecretKey } from './common/paths';

async function bootstrap() {
  ensureDataDirs();
  process.env.DATABASE_URL ||= `file:${path.join(DATA_DIR, 'lanatlas.db')}`;
  const key = ensureSecretKey();
  if (process.env.MIGRATE_ON_START !== '0') {
    // Crea o actualitza la base de dades (migracions de Prisma) abans d'obrir-la.
    const cli = require.resolve('prisma/build/index.js');
    execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.resolve(__dirname, '..', 'prisma', 'schema.prisma')], {
      stdio: 'inherit',
      env: process.env,
    });
  }

  // L'AppModule es carrega després de fixar DATABASE_URL i la clau.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const logger = new Logger('LanAtlas');

  app.useBodyParser('json', { limit: '32mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  app.use(requestGuard());

  // Frontend compilat (web/dist): el serveix el mateix procés.
  const web = process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(path.join(web, 'index.html'))) {
    app.useStaticAssets(web, { index: false, maxAge: '1h' });
    const indexFile = path.join(web, 'index.html');
    // SPA: qualsevol GET que no sigui de l'API ni un fitxer torna l'index.html.
    app.use((req: { method: string; path: string }, res: { sendFile: (file: string) => void }, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/api') return next();
      res.sendFile(indexFile);
    });
  } else {
    logger.warn(`No hi ha frontend compilat a ${web} (npm run build). Només s'exposa l'API.`);
  }

  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, host);
  logger.log(`LanAtlas a http://${host === '0.0.0.0' ? 'localhost' : host}:${port} · dades a ${DATA_DIR}`);
  if (key === 'generated') logger.warn(`S'ha creat la clau secreta ${path.join(DATA_DIR, 'secret.key')}: feu-ne còpia amb la base de dades.`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    logger.warn('LanAtlas no té usuaris: qualsevol que arribi a aquest port pot veure i canviar-ho tot. Limiteu-ne l’accés.');
  }
}

/**
 * Sense usuaris, cal evitar que una altra web oberta al navegador faci servir l'API:
 * - les escriptures han de portar la capçalera `X-LanAtlas` (una web d'un altre origen no la pot posar sense
 *   permís CORS, que no es dona);
 * - amb ALLOWED_HOSTS (per defecte, quan s'escolta només en local) es rebutgen noms de host estranys
 *   (atacs de «DNS rebinding»).
 */
function requestGuard() {
  const local = !process.env.HOST || ['127.0.0.1', 'localhost'].includes(process.env.HOST);
  const allowed = (process.env.ALLOWED_HOSTS ?? (local ? 'localhost,127.0.0.1' : ''))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return (
    req: { method: string; path: string; headers: Record<string, string | string[] | undefined> },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const hostname = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    if (allowed.length && !allowed.includes(hostname)) return res.status(421).json({ message: `Host no permès: ${hostname} (ALLOWED_HOSTS)` });
    if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['x-lanatlas']) {
      return res.status(403).json({ message: 'Falta la capçalera X-LanAtlas' });
    }
    next();
  };
}

void bootstrap();
