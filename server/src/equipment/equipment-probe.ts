import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';

/**
 * Proves de xarxa que llança el servidor:
 * - PING: binari `ping` del sistema (iputils al contenidor). Node no fa ICMP.
 * - TCP: obrir una connexió al port.
 * - HTTP(S): respon amb un estat < 500 (401/403 compten com a OK: l'equip
 *   contesta). De les HTTPS en guarda la caducitat del certificat, que
 *   s'accepta encara que sigui autosignat (és la xarxa interna).
 *
 * `unavailable`: la prova no s'ha pogut fer per un problema del servidor (no
 * hi ha `ping`): no compta com a fallada de l'equip.
 */
export interface ProbeResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  unavailable?: boolean;
  certExpiresAt?: Date | null;
}

const PING_TIMEOUT_S = 2;
const TCP_TIMEOUT_MS = 3000;
const HTTP_TIMEOUT_MS = 8000;

export function probePing(host: string): Promise<ProbeResult> {
  const windows = process.platform === 'win32';
  const args = windows ? ['-n', '1', '-w', String(PING_TIMEOUT_S * 1000), host] : ['-c', '1', '-W', String(PING_TIMEOUT_S), host];
  const started = Date.now();
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: (PING_TIMEOUT_S + 2) * 1000, windowsHide: true }, (error, stdout) => {
      const text = String(stdout ?? '');
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return resolve({ ok: false, latencyMs: null, error: 'ping no disponible al servidor', unavailable: true });
      }
      if (/operation not permitted|permission denied/i.test(text + String((error as Error | null)?.message ?? ''))) {
        return resolve({ ok: false, latencyMs: null, error: 'el servidor no té permís per fer ping', unavailable: true });
      }
      // Windows torna 0 amb «Host de destino inaccesible»: cal veure un temps.
      // «time=3ms», «tiempo<1m» (Windows en castellà escurça «ms»), «temps=2 ms».
      const time = /(?:time|tiempo|temps|zeit|durée)[=<]\s*([\d.,]+)\s*m/i.exec(text);
      if (!error && time) {
        return resolve({ ok: true, latencyMs: Math.max(0, Math.round(Number(time[1].replace(',', '.')))), error: null });
      }
      if (!error && !windows) {
        return resolve({ ok: true, latencyMs: Date.now() - started, error: null });
      }
      return resolve({ ok: false, latencyMs: null, error: 'Sense resposta al ping' });
    });
  });
}

export function probeTcp(host: string, port: number): Promise<ProbeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (result: ProbeResult) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - started, error: null }));
    socket.once('timeout', () => finish({ ok: false, latencyMs: null, error: `El port ${port} no contesta` }));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        latencyMs: null,
        error: error.code === 'ECONNREFUSED' ? `Port ${port} tancat` : `Error al port ${port}: ${error.code ?? error.message}`,
      }),
    );
  });
}

export function probeHttp(url: string): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve({ ok: false, latencyMs: null, error: 'Adreça HTTP no vàlida' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.resolve({ ok: false, latencyMs: null, error: 'Només http:// o https://' });
  }
  const secure = parsed.protocol === 'https:';
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    let certExpiresAt: Date | null = null;
    const finish = (result: ProbeResult) => {
      if (done) return;
      done = true;
      resolve({ ...result, certExpiresAt });
    };
    const request = (secure ? https : http).request(
      parsed,
      { method: 'GET', timeout: HTTP_TIMEOUT_MS, ...(secure ? { rejectUnauthorized: false } : {}), headers: { 'User-Agent': 'LanAtlas/1' } },
      (response) => {
        const status = response.statusCode ?? 0;
        response.resume();
        finish(
          status > 0 && status < 500
            ? { ok: true, latencyMs: Date.now() - started, error: null }
            : { ok: false, latencyMs: Date.now() - started, error: `Resposta HTTP ${status}` },
        );
      },
    );
    if (secure) {
      request.once('socket', (socket) => {
        socket.once('secureConnect', () => {
          const cert = (socket as TLSSocket).getPeerCertificate?.();
          const until = cert?.valid_to ? new Date(cert.valid_to) : null;
          certExpiresAt = until && !Number.isNaN(until.getTime()) ? until : null;
        });
      });
    }
    request.once('timeout', () => {
      request.destroy();
      finish({ ok: false, latencyMs: null, error: 'No contesta (temps esgotat)' });
    });
    request.once('error', (error: NodeJS.ErrnoException) =>
      finish({ ok: false, latencyMs: null, error: `Error HTTP: ${error.code ?? error.message}` }),
    );
    request.end();
  });
}
