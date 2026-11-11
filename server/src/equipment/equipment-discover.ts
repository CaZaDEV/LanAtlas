import dgram from 'node:dgram';
import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';

/**
 * Identificació d'un aparell desconegut de la xarxa (pestanya IPs). Totes les proves són de només lectura i
 * es llancen alhora des del servidor:
 * - DNS invers (resolutor del sistema) i mDNS unicast (port 5353: impressores, Apple, Linux amb Avahi);
 * - NetBIOS NBSTAT (UDP 137): nom de l'ordinador Windows, grup de treball i MAC;
 * - SNMP v1 amb la comunitat «public» (UDP 161): descripció, nom i ubicació (impressores, switches, SAI…);
 * - ports TCP habituals (oficina, impressió, càmeres, PLC…);
 * - web HTTP/HTTPS als ports oberts: títol, capçalera Server, «realm» d'autenticació i certificat;
 * - salutacions SSH/FTP i RTSP OPTIONS (càmeres).
 * No s'envia res al 9100 (impressió directa): un text que la impressora no entengués podria sortir imprès.
 */

export interface DiscoveredPort {
  port: number;
  service: string;
}

export interface DiscoveredWeb {
  port: number;
  scheme: 'http' | 'https';
  status: number | null;
  server: string | null;
  title: string | null;
  realm: string | null;
  location: string | null;
  certSubject: string | null;
  certIssuer: string | null;
}

export interface Discovery {
  ip: string;
  at: string;
  durationMs: number;
  alive: boolean;
  names: { source: string; name: string }[];
  mac: string | null;
  workgroup: string | null;
  snmp: { descr: string | null; name: string | null; location: string | null; contact: string | null } | null;
  ports: DiscoveredPort[];
  web: DiscoveredWeb[];
  banners: { port: number; text: string }[];
  guess: { typeId: string; label: string; confidence: 'alta' | 'mitjana' | 'baixa'; reasons: string[] };
}

/** Ports que es proven: [port, servei]. */
export const DISCOVER_PORTS: [number, string][] = [
  [21, 'FTP'],
  [22, 'SSH'],
  [23, 'Telnet'],
  [25, 'Correu (SMTP)'],
  [53, 'DNS'],
  [80, 'Web'],
  [102, 'Siemens S7 (PLC)'],
  [135, 'Windows RPC'],
  [139, 'NetBIOS'],
  [443, 'Web segura'],
  [445, 'Carpetes compartides (SMB)'],
  [502, 'Modbus (PLC)'],
  [515, 'Impressió LPD'],
  [554, 'Vídeo RTSP'],
  [631, 'Impressió IPP'],
  [1433, 'SQL Server'],
  [1883, 'MQTT (IoT)'],
  [3306, 'MySQL'],
  [3389, 'Escriptori remot'],
  [4840, 'OPC UA (màquina)'],
  [5000, 'Web / NAS'],
  [5900, 'VNC'],
  [8000, 'Web alternativa'],
  [8080, 'Web alternativa'],
  [8443, 'Web segura alternativa'],
  [9100, 'Impressió directa'],
  [37777, 'Dahua (càmeres)'],
  [44818, 'EtherNet/IP (PLC)'],
  [62078, 'iPhone / iPad'],
];

/** Ports per decidir ràpidament si una IP té algú (molts Windows no responen al ping). */
export const ALIVE_PORTS = [80, 443, 445, 3389, 9100, 22, 554, 139];

const TCP_TIMEOUT_MS = 1500;
const UDP_TIMEOUT_MS = 2000;
const HTTP_TIMEOUT_MS = 4000;
const WEB_PORTS: [number, 'http' | 'https'][] = [
  [80, 'http'],
  [443, 'https'],
  [8080, 'http'],
  [8000, 'http'],
  [8443, 'https'],
  [5000, 'http'],
];

// ── Codificació i lectura de paquets (purs, amb tests) ───────────────────────

/** Consulta NetBIOS NBSTAT per al nom «*». */
export function nbstatQuery(id = 0x4e42): Buffer {
  const header = Buffer.from([id >> 8, id & 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const raw = Buffer.alloc(16, 0);
  raw[0] = 0x2a; // '*'
  const encoded = Buffer.alloc(32);
  for (let i = 0; i < 16; i += 1) {
    encoded[i * 2] = 0x41 + (raw[i] >> 4);
    encoded[i * 2 + 1] = 0x41 + (raw[i] & 0x0f);
  }
  return Buffer.concat([header, Buffer.from([0x20]), encoded, Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01])]);
}

/** Salta un nom DNS (amb punters) i torna on acaba. */
function skipDnsName(buf: Buffer, offset: number): number {
  let off = offset;
  while (off < buf.length) {
    const len = buf[off];
    if (len === 0) return off + 1;
    if ((len & 0xc0) === 0xc0) return off + 2;
    off += len + 1;
  }
  throw new Error('Nom DNS tallat');
}

export interface NbstatInfo {
  name: string | null;
  workgroup: string | null;
  fileServer: boolean;
  mac: string | null;
}

/** Llegeix la resposta NBSTAT: nom de l'equip (únic, sufix 0x00), grup (sufix 0x00 de grup) i MAC. */
export function parseNbstat(buf: Buffer): NbstatInfo | null {
  if (buf.length < 12 || buf.readUInt16BE(6) < 1) return null;
  let off = skipDnsName(buf, 12);
  off += 10; // tipus, classe, TTL, longitud
  if (off >= buf.length) return null;
  const count = buf[off];
  off += 1;
  let name: string | null = null;
  let workgroup: string | null = null;
  let fileServer = false;
  for (let i = 0; i < count && off + 18 <= buf.length; i += 1) {
    const label = buf.toString('latin1', off, off + 15).replace(/[\0 ]+$/, '');
    const suffix = buf[off + 15];
    const group = (buf.readUInt16BE(off + 16) & 0x8000) !== 0;
    if (suffix === 0x00 && !group && !name) name = label;
    if (suffix === 0x00 && group && !workgroup) workgroup = label;
    if (suffix === 0x20) fileServer = true;
    off += 18;
  }
  let mac: string | null = null;
  if (off + 6 <= buf.length) {
    const bytes = [...buf.subarray(off, off + 6)];
    if (bytes.some((byte) => byte !== 0)) mac = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
  }
  return { name, workgroup, fileServer, mac };
}

/** Consulta DNS PTR (per a mDNS unicast al 5353). */
export function ptrQuery(ip: string, id = 0x1234): Buffer {
  const labels = [...ip.split('.').reverse(), 'in-addr', 'arpa'];
  const name = Buffer.concat([...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')])), Buffer.from([0])]);
  const header = Buffer.from([id >> 8, id & 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  return Buffer.concat([header, name, Buffer.from([0x00, 0x0c, 0x00, 0x01])]);
}

function readDnsName(buf: Buffer, offset: number, depth = 0): string {
  const parts: string[] = [];
  let off = offset;
  while (off < buf.length && depth < 10) {
    const len = buf[off];
    if (len === 0) break;
    if ((len & 0xc0) === 0xc0) {
      parts.push(readDnsName(buf, ((len & 0x3f) << 8) | buf[off + 1], depth + 1));
      break;
    }
    parts.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += len + 1;
  }
  return parts.filter(Boolean).join('.');
}

/** Primer nom PTR de la resposta, sense «.local». */
export function parsePtr(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const questions = buf.readUInt16BE(4);
  const answers = buf.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < questions; i += 1) off = skipDnsName(buf, off) + 4;
  for (let i = 0; i < answers && off < buf.length; i += 1) {
    off = skipDnsName(buf, off);
    const type = buf.readUInt16BE(off);
    const length = buf.readUInt16BE(off + 8);
    off += 10;
    if (type === 12) {
      const name = readDnsName(buf, off).replace(/\.$/, '');
      return name ? name.replace(/\.local$/i, '') : null;
    }
    off += length;
  }
  return null;
}

function berLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function ber(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), berLength(content.length), content]);
}

export function berOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift(0x80 | (value & 0x7f));
    bytes.push(...chunk);
  }
  return ber(0x06, Buffer.from(bytes));
}

export const SNMP_OIDS = {
  descr: '1.3.6.1.2.1.1.1.0',
  contact: '1.3.6.1.2.1.1.4.0',
  name: '1.3.6.1.2.1.1.5.0',
  location: '1.3.6.1.2.1.1.6.0',
} as const;

/** GetRequest SNMP v1 (comunitat «public») dels camps del grup «system». */
export function snmpGet(requestId = 0x4e42, community = 'public'): Buffer {
  const varbinds = Object.values(SNMP_OIDS).map((oid) => ber(0x30, Buffer.concat([berOid(oid), Buffer.from([0x05, 0x00])])));
  const pdu = ber(
    0xa0,
    Buffer.concat([ber(0x02, Buffer.from([(requestId >> 8) & 0x7f, requestId & 0xff])), ber(0x02, Buffer.from([0])), ber(0x02, Buffer.from([0])), ber(0x30, Buffer.concat(varbinds))]),
  );
  return ber(0x30, Buffer.concat([ber(0x02, Buffer.from([0])), ber(0x04, Buffer.from(community, 'ascii')), pdu]));
}

interface BerNode {
  tag: number;
  value: Buffer;
  children: BerNode[];
}

function berParse(buf: Buffer, start = 0, end = buf.length, depth = 0): BerNode[] {
  const nodes: BerNode[] = [];
  let off = start;
  while (off + 2 <= end && depth < 8) {
    const tag = buf[off];
    let length = buf[off + 1];
    off += 2;
    if (length & 0x80) {
      const bytes = length & 0x7f;
      if (bytes > 4) break;
      length = 0;
      for (let i = 0; i < bytes; i += 1) length = (length << 8) | buf[off + i];
      off += bytes;
    }
    if (off + length > end) break;
    const value = buf.subarray(off, off + length);
    nodes.push({ tag, value, children: tag & 0x20 ? berParse(buf, off, off + length, depth + 1) : [] });
    off += length;
  }
  return nodes;
}

function oidString(value: Buffer): string {
  if (!value.length) return '';
  const parts = [Math.floor(value[0] / 40), value[0] % 40];
  let current = 0;
  for (const byte of value.subarray(1)) {
    current = (current << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(current);
      current = 0;
    }
  }
  return parts.join('.');
}

/** Valors de text de la resposta SNMP, per OID. */
export function parseSnmp(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (nodes: BerNode[]) => {
    for (const node of nodes) {
      if (node.tag === 0x30 && node.children.length === 2 && node.children[0].tag === 0x06) {
        const [oid, value] = node.children;
        if (value.tag === 0x04) {
          const text = value.value.toString('utf8').replace(/[\0\r]+/g, '').trim();
          if (text) out[oidString(oid.value)] = text;
        }
      } else if (node.children.length) {
        walk(node.children);
      }
    }
  };
  walk(berParse(buf));
  return out;
}

/** Títol d'una pàgina HTML (net d'espais i entitats bàsiques). */
export function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const text = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 160) : null;
}

/** Tipus més probable a partir del que s'ha trobat. `typeId` són els tipus de la migració. */
export function guessDevice(d: Pick<Discovery, 'names' | 'mac' | 'snmp' | 'ports' | 'web' | 'banners'>): Discovery['guess'] {
  const open = new Set(d.ports.map((port) => port.port));
  const text = [
    d.snmp?.descr,
    d.snmp?.name,
    ...d.web.flatMap((web) => [web.title, web.server, web.realm, web.certSubject]),
    ...d.banners.map((banner) => banner.text),
    ...d.names.map((name) => name.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const has = (pattern: RegExp) => pattern.test(text);
  const rules: { typeId: string; label: string; strong: boolean; reasons: string[] }[] = [];
  const add = (typeId: string, label: string, strong: boolean, reason: string) => {
    const found = rules.find((rule) => rule.typeId === typeId);
    if (found) {
      found.reasons.push(reason);
      found.strong ||= strong;
    } else rules.push({ typeId, label, strong, reasons: [reason] });
  };

  if (has(/printer|laserjet|officejet|bizhub|kyocera|ecosys|taskalfa|brother|epson|ricoh|lexmark|xerox|zebra|zt[0-9]{3}|canon i?r|imagerunner|konica|sharp mx|oki/))
    add('type-printer', 'Impressora', true, 'El nom o la descripció és d’impressora');
  if (open.has(9100)) add('type-printer', 'Impressora', false, 'Port 9100 (impressió directa) obert');
  if (open.has(515) || open.has(631)) add('type-printer', 'Impressora', false, 'Ports d’impressió (LPD/IPP) oberts');

  if (has(/hikvision|dahua|axis|ipcam|ip camera|network camera|nvr|dvr|webcam|reolink|uniview|camera/)) add('type-camera', 'Càmera', true, 'El web o el nom és de càmera / gravador');
  if (open.has(554)) add('type-camera', 'Càmera', false, 'Port 554 (vídeo RTSP) obert');
  if (open.has(37777)) add('type-camera', 'Càmera', true, 'Port 37777 (Dahua) obert');

  if (open.has(102) || open.has(502) || open.has(4840) || open.has(44818))
    add('type-machine', 'Màquina de taller / PLC', true, 'Ports industrials oberts (S7, Modbus, OPC UA o EtherNet/IP)');
  if (has(/siemens|simatic|trumpf|bystronic|amada|fanuc|kuka|abb robot|beckhoff|schneider|omron|mitsubishi|plc|hmi/))
    add('type-machine', 'Màquina de taller / PLC', true, 'El nom o la descripció és d’un fabricant de màquines / PLC');

  if (has(/routeros|mikrotik|ubiquiti|unifi|edgeos|tp-link|tplink|netgear|cisco|aruba|d-link|zyxel|fortigate|fortinet|router|switch|access point|openwrt|livebox|fritz/))
    add('type-network', 'Xarxa (router, switch, AP)', true, 'El web o la descripció és d’equip de xarxa');
  if (open.has(53) && !open.has(445)) add('type-network', 'Xarxa (router, switch, AP)', false, 'Port 53 (DNS) obert');

  if (has(/synology|diskstation|qnap|truenas|nas\b|esxi|vmware|proxmox|idrac|ilo |integrated lights|windows server/))
    add('type-server', 'Servidor / NAS', true, 'El web o la descripció és de servidor o NAS');
  if (open.has(1433) || open.has(3306)) add('type-server', 'Servidor / NAS', false, 'Base de dades (SQL Server o MySQL) oberta');

  const windows = d.names.some((name) => name.source === 'NetBIOS') || open.has(445) || open.has(3389) || open.has(135);
  if (windows) {
    const reasons = [
      d.names.some((name) => name.source === 'NetBIOS') ? 'Té nom de Windows (NetBIOS)' : null,
      open.has(445) ? 'Comparteix carpetes (SMB)' : null,
      open.has(3389) ? 'Escriptori remot obert' : null,
    ].filter(Boolean) as string[];
    for (const reason of reasons.length ? reasons : ['Ports de Windows oberts']) add('type-pc', 'Ordinador Windows', false, reason);
  }
  if (has(/raspberry|raspbian/)) add('type-iot', 'Raspberry Pi / Linux', true, 'El nom o la salutació és de Raspberry Pi');
  if (open.has(1883)) add('type-iot', 'Instal·lació / IoT', false, 'Port 1883 (MQTT) obert');
  if (open.has(62078)) add('type-other', 'iPhone / iPad', true, 'Port 62078 (dispositiu Apple) obert');
  if (has(/android|iphone|ipad|galaxy/)) add('type-other', 'Mòbil o tauleta', true, 'El nom és d’un mòbil o tauleta');
  if (has(/openssh|linux|ubuntu|debian/) && !rules.length) add('type-server', 'Linux', false, 'Salutació SSH de Linux');

  if (!rules.length) {
    return { typeId: 'type-other', label: 'Desconegut', confidence: 'baixa', reasons: ['No s’ha trobat cap pista clara: respon però no diu què és'] };
  }
  rules.sort((a, b) => Number(b.strong) - Number(a.strong) || b.reasons.length - a.reasons.length);
  const best = rules[0];
  return { typeId: best.typeId, label: best.label, confidence: best.strong ? 'alta' : best.reasons.length > 1 ? 'mitjana' : 'baixa', reasons: best.reasons };
}

// ── Proves de xarxa ──────────────────────────────────────────────────────────

/** Obre una connexió TCP; si `read` és cert, espera la primera línia que envia el servidor (SSH, FTP). */
export function tcpProbe(host: string, port: number, opts: { read?: boolean; send?: string; timeoutMs?: number } = {}): Promise<{ open: boolean; text: string | null }> {
  const timeout = opts.timeoutMs ?? TCP_TIMEOUT_MS;
  return new Promise((resolve) => {
    let open = false;
    let text = '';
    let done = false;
    const socket = net.connect({ host, port });
    const finish = () => {
      if (done) return;
      done = true;
      socket.destroy();
      const clean = text.replace(/[^\x20-\x7e -￿\n]/g, '').trim();
      resolve({ open, text: clean ? clean.split('\n').slice(0, 6).join('\n').slice(0, 300) : null });
    };
    socket.setTimeout(timeout, finish);
    socket.once('connect', () => {
      open = true;
      if (!opts.read && !opts.send) return finish();
      if (opts.send) socket.write(opts.send);
    });
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('latin1');
      if (text.length > 600 || (!opts.send && text.includes('\n')) || (opts.send && text.includes('\r\n\r\n'))) finish();
    });
    socket.once('error', finish);
    socket.once('close', finish);
  });
}

function udpQuery(host: string, port: number, payload: Buffer, timeoutMs = UDP_TIMEOUT_MS): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let done = false;
    const finish = (value: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ja tancat
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('message', (message) => finish(message));
    socket.once('error', () => finish(null));
    socket.send(payload, port, host, (error) => {
      if (error) finish(null);
    });
  });
}

function certName(fields: Record<string, string | string[] | undefined> | undefined): string | null {
  if (!fields) return null;
  const pick = (key: string) => {
    const value = fields[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const text = [pick('CN'), pick('O')].filter(Boolean).join(' · ');
  return text || null;
}

/** GET / (sense seguir redireccions) i en treu el que identifica l'aparell. */
export function webProbe(host: string, port: number, scheme: 'http' | 'https'): Promise<DiscoveredWeb | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DiscoveredWeb | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const lib = scheme === 'https' ? https : http;
    const request = lib.request(
      { host, port, path: '/', method: 'GET', timeout: HTTP_TIMEOUT_MS, rejectUnauthorized: false, headers: { 'User-Agent': 'LanAtlas/1.0', Accept: 'text/html,*/*' } },
      (response) => {
        let certSubject: string | null = null;
        let certIssuer: string | null = null;
        if (scheme === 'https') {
          const cert = (response.socket as TLSSocket).getPeerCertificate?.();
          certSubject = certName(cert?.subject as never);
          certIssuer = certName(cert?.issuer as never);
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 65536) response.destroy();
        });
        const done = () => {
          const header = (name: string) => {
            const value = response.headers[name];
            return (Array.isArray(value) ? value[0] : value) ?? null;
          };
          const realm = /realm="?([^",]+)/i.exec(header('www-authenticate') ?? '')?.[1] ?? null;
          finish({
            port,
            scheme,
            status: response.statusCode ?? null,
            server: header('server'),
            title: htmlTitle(body),
            realm,
            location: header('location'),
            certSubject,
            certIssuer,
          });
        };
        response.on('end', done);
        response.on('close', done);
        response.on('error', done);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => finish(null));
    request.end();
  });
}

/** Totes les proves sobre una IP. Unes 4-6 s. */
export async function discoverHost(ip: string, pingAlive: boolean | null = null): Promise<Discovery> {
  const started = Date.now();
  const [reverse, mdns, nbstat, snmpRaw, portResults] = await Promise.all([
    dns.reverse(ip).catch(() => [] as string[]),
    udpQuery(ip, 5353, ptrQuery(ip)).then((buf) => (buf ? parsePtr(buf) : null)).catch(() => null),
    udpQuery(ip, 137, nbstatQuery()).then((buf) => (buf ? parseNbstat(buf) : null)).catch(() => null),
    udpQuery(ip, 161, snmpGet()).then((buf) => (buf ? parseSnmp(buf) : null)).catch(() => null),
    Promise.all(DISCOVER_PORTS.map(async ([port, service]) => ((await tcpProbe(ip, port)).open ? { port, service } : null))),
  ]);
  const ports = portResults.filter((row): row is DiscoveredPort => row !== null);
  const open = new Set(ports.map((port) => port.port));

  const [web, banners] = await Promise.all([
    Promise.all(WEB_PORTS.filter(([port]) => open.has(port)).map(([port, scheme]) => webProbe(ip, port, scheme))).then((rows) =>
      rows.filter((row): row is DiscoveredWeb => row !== null),
    ),
    Promise.all([
      open.has(22) ? tcpProbe(ip, 22, { read: true, timeoutMs: 2500 }).then((row) => (row.text ? { port: 22, text: row.text } : null)) : null,
      open.has(21) ? tcpProbe(ip, 21, { read: true, timeoutMs: 2500 }).then((row) => (row.text ? { port: 21, text: row.text } : null)) : null,
      open.has(554)
        ? tcpProbe(ip, 554, { send: `OPTIONS rtsp://${ip}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: LanAtlas\r\n\r\n`, timeoutMs: 2500 }).then((row) =>
            row.text ? { port: 554, text: row.text } : null,
          )
        : null,
    ]).then((rows) => rows.filter((row): row is { port: number; text: string } => !!row)),
  ]);

  const names: Discovery['names'] = [];
  const addName = (source: string, name: string | null | undefined) => {
    const clean = name?.trim().replace(/\.$/, '');
    if (clean && !names.some((row) => row.name.toLowerCase() === clean.toLowerCase())) names.push({ source, name: clean });
  };
  addName('NetBIOS', nbstat?.name);
  for (const name of reverse) addName('DNS', name);
  addName('mDNS', mdns);
  addName('SNMP', snmpRaw?.[SNMP_OIDS.name]);
  // Del certificat només el CN que sembla un nom de host («mkcert development certificate» no ho és).
  for (const row of web) {
    const cn = row.certSubject?.split(' · ')[0];
    if (cn && /^[a-z0-9][a-z0-9.-]*$/i.test(cn)) addName('Certificat', cn);
  }

  const snmp = snmpRaw && Object.keys(snmpRaw).length
    ? {
        descr: snmpRaw[SNMP_OIDS.descr] ?? null,
        name: snmpRaw[SNMP_OIDS.name] ?? null,
        location: snmpRaw[SNMP_OIDS.location] ?? null,
        contact: snmpRaw[SNMP_OIDS.contact] ?? null,
      }
    : null;
  const partial = { names, mac: nbstat?.mac ?? null, snmp, ports, web, banners };
  const alive = !!pingAlive || ports.length > 0 || !!nbstat || !!snmp || !!mdns;
  return {
    ip,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    alive,
    workgroup: nbstat?.workgroup ?? null,
    ...partial,
    guess: guessDevice(partial),
  };
}

/** Comprovació ràpida per a l'escaneig: algun dels ports habituals obert. */
export async function anyPortOpen(ip: string): Promise<number | null> {
  const results = await Promise.all(ALIVE_PORTS.map(async (port) => ((await tcpProbe(ip, port, { timeoutMs: 1200 })).open ? port : null)));
  return results.find((port) => port !== null) ?? null;
}
