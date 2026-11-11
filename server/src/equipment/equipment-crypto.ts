import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Xifratge de les dades sensibles del mòdul Equips (claus de llicència i
 * credencials): AES-256-GCM amb una clau derivada (SHA-256) de
 * `LANATLAS_SECRET_KEY` (si no es dona, el servidor en genera una a DATA_DIR/secret.key en
 * arrencar: feu-ne còpia amb la base de dades). Sense clau no es poden desar ni revelar secrets.
 *
 * Format: `v1:<iv base64>:<tag base64>:<xifrat base64>`.
 * Canviar la variable fa illegibles els secrets ja desats: no s'ha de canviar.
 */
const MIN_LENGTH = 16;

export function secretsKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.LANATLAS_SECRET_KEY?.trim();
  if (!raw || raw.length < MIN_LENGTH) return null;
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Null si el text no té el format o la clau no és la bona. */
export function decryptSecret(stored: string, key: Buffer): string | null {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Pista visible d'una clau: els 3 últims caràcters alfanumèrics («…123»). */
export function secretHint(plain: string): string | null {
  const clean = plain.replace(/[^0-9a-z]/gi, '');
  return clean.length >= 6 ? clean.slice(-3).toUpperCase() : null;
}
