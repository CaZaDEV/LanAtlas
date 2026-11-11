import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** Carpeta de dades: base de dades, clau secreta i fitxers dels mapes. Feu-ne còpia sencera. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');

export function ensureDataDirs() {
  mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Clau per xifrar contrasenyes i claus de llicència. Si no es dona LANATLAS_SECRET_KEY, se'n genera una a
 * DATA_DIR/secret.key el primer cop (i es reutilitza). Perdre-la fa illegibles els secrets desats.
 */
export function ensureSecretKey(): 'env' | 'file' | 'generated' {
  if ((process.env.LANATLAS_SECRET_KEY ?? '').trim().length >= 16) return 'env';
  const file = path.join(DATA_DIR, 'secret.key');
  let created = false;
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    created = true;
  }
  process.env.LANATLAS_SECRET_KEY = readFileSync(file, 'utf8').trim();
  return created ? 'generated' : 'file';
}
