import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Carrega `.env` (a la carpeta actual o a l'arrel del projecte) si existeix. Les variables ja definides
 * a l'entorn tenen prioritat. S'importa abans que cap altre mòdul que llegeixi `process.env`.
 */
for (const file of [path.resolve('.env'), path.resolve(__dirname, '..', '..', '..', '.env')]) {
  if (!existsSync(file)) continue;
  try {
    (process as unknown as { loadEnvFile?: (file: string) => void }).loadEnvFile?.(file);
  } catch {
    // Fitxer il·legible: s'ignora i es fan servir els valors per defecte.
  }
  break;
}
