/**
 * Avisos de les alertes cap a fora (substitueixen el xat de l'aplicació original):
 * - `json`: POST amb `{ text, content, title, lines }`. `text` el llegeixen Slack, Mattermost, Rocket.Chat i
 *   Google Chat; `content`, Discord. Qualsevol servei propi pot fer servir `lines`.
 * - `ntfy`: POST de text pla amb capçalera `Title` (ntfy.sh o un servidor ntfy propi).
 */
export type WebhookFormat = 'json' | 'ntfy';

export interface Webhook {
  url: string;
  format: WebhookFormat;
}

const TIMEOUT_MS = 8000;

export function cleanWebhooks(input: unknown): Webhook[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => row as Partial<Webhook> | null)
    .filter((row): row is Webhook => typeof row?.url === 'string' && /^https?:\/\//.test(row.url))
    .map((row) => ({ url: row.url, format: row.format === 'ntfy' ? 'ntfy' : 'json' }));
}

export async function sendWebhook(hook: Webhook, title: string, lines: string[]): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const text = [title, ...lines].join('\n').slice(0, 3900);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      hook.url,
      hook.format === 'ntfy'
        ? { method: 'POST', body: lines.join('\n').slice(0, 3900), headers: { Title: encodeTitle(title), Tags: 'computer' }, signal: controller.signal }
        : {
            method: 'POST',
            body: JSON.stringify({ text, content: text, title, lines }),
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
          },
    );
    return { ok: response.ok, status: response.status, error: response.ok ? null : `Resposta HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: null, error: (error as Error).name === 'AbortError' ? 'No contesta (temps esgotat)' : (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function sendWebhookTest(hook: Webhook) {
  return sendWebhook(hook, 'LanAtlas', ['✅ Prova d’avís: si veus això, les alertes arribaran aquí.']);
}

/** Les capçaleres HTTP han de ser ASCII: ntfy accepta RFC 2047. */
function encodeTitle(title: string): string {
  return /^[\x20-\x7e]*$/.test(title) ? title : `=?UTF-8?B?${Buffer.from(title, 'utf8').toString('base64')}?=`;
}
