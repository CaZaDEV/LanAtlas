import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { probeHttp, probeTcp } from './equipment-probe';

describe('equipment-probe', () => {
  let tcp: net.Server;
  let web: http.Server;
  let tcpPort: number;
  let webPort: number;

  beforeAll(async () => {
    tcp = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    tcpPort = (tcp.address() as AddressInfo).port;
    web = http.createServer((req, res) => {
      res.statusCode = req.url === '/error' ? 503 : req.url === '/login' ? 401 : 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    webPort = (web.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => tcp.close(resolve));
    await new Promise((resolve) => web.close(resolve));
  });

  it('TCP: port obert i port tancat', async () => {
    await expect(probeTcp('127.0.0.1', tcpPort)).resolves.toEqual(expect.objectContaining({ ok: true, error: null }));
    const closed = await new Promise<number>((resolve) => {
      const probe = net.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const port = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    const result = await probeTcp('127.0.0.1', closed);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(`Port ${closed} tancat`);
  });

  it('HTTP: < 500 és OK (també 401), 5xx falla', async () => {
    await expect(probeHttp(`http://127.0.0.1:${webPort}/`)).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(probeHttp(`http://127.0.0.1:${webPort}/login`)).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(probeHttp(`http://127.0.0.1:${webPort}/error`)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: 'Resposta HTTP 503' }),
    );
  });

  it('HTTP: rebutja adreces que no són http(s)', async () => {
    await expect(probeHttp('file:///etc/passwd')).resolves.toEqual(expect.objectContaining({ ok: false, error: 'Només http:// o https://' }));
    await expect(probeHttp('no és una url')).resolves.toEqual(expect.objectContaining({ ok: false, error: 'Adreça HTTP no vàlida' }));
  });
});
