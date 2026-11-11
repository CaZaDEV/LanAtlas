import axios from 'axios';

/**
 * Client de l'API. La capçalera `X-LanAtlas` és obligatòria a les escriptures: una web d'un altre origen no la
 * pot enviar (el servidor no dona permís CORS), així que no pot fer servir l'API des del navegador de l'usuari.
 */
export const api = axios.create({
  baseURL: '/api',
  headers: { 'X-LanAtlas': '1' },
});

/** Missatge d'error llegible a partir d'un error d'Axios. */
export function readError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[]; error?: string } | undefined;
    if (data?.message) return Array.isArray(data.message) ? data.message.join(' • ') : data.message;
    if (data?.error) return data.error;
    if (!err.response) return 'No es pot connectar amb el servidor';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Error desconegut';
}
