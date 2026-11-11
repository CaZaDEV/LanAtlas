/**
 * Regles pures del mòdul Equips i xarxa (sense Prisma ni xarxa): adreces,
 * estat de les proves i càlcul de les alertes que haurien d'estar obertes.
 * El servei i el monitor les apliquen; els tests les fixen.
 */

export type CheckState = 'UNKNOWN' | 'UP' | 'DOWN';
export type AlertKind =
  | 'DOWN'
  | 'LICENSE_EXPIRING'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_OVERUSED'
  | 'CERT_EXPIRING'
  | 'IP_DUPLICATE'
  | 'IP_IN_DHCP';

export interface DhcpRange {
  from: string;
  to: string;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Nom de host senzill (sense espais ni guió inicial: no pot semblar una opció de `ping`).
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** «192.168.001.013» → «192.168.1.13». Null si no és una IPv4 vàlida. */
export function normalizeIpv4(value: string | null | undefined): string | null {
  const match = IPV4.exec((value ?? '').trim());
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  return parts.join('.');
}

/** IPv4 normalitzada d'una xarxa privada (10/8, 172.16/12, 192.168/16). Null si no ho és: l'escaneig només toca la xarxa interna. */
export function privateIpv4(value: string | null | undefined): string | null {
  const ip = normalizeIpv4(value);
  if (!ip) return null;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? ip : null;
}

/** IPv4 normalitzada o nom de host en minúscules. Null si no és cap de les dues. */
export function normalizeHost(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^[\d.]+$/.test(text)) return normalizeIpv4(text);
  return HOSTNAME.test(text) ? text.toLowerCase() : null;
}

export function ipv4ToNumber(ip: string): number | null {
  const normalized = normalizeIpv4(ip);
  if (!normalized) return null;
  return normalized.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** Rang DHCP on cau la IP (null si cap). */
export function dhcpRangeOf(ip: string, ranges: DhcpRange[]): DhcpRange | null {
  const value = ipv4ToNumber(ip);
  if (value === null) return null;
  for (const range of ranges) {
    const from = ipv4ToNumber(range.from);
    const to = ipv4ToNumber(range.to);
    if (from === null || to === null) continue;
    if (value >= Math.min(from, to) && value <= Math.max(from, to)) return range;
  }
  return null;
}

/** Rangs vàlids i normalitzats (descarta els que no són IPv4). */
export function cleanRanges(input: unknown): DhcpRange[] {
  if (!Array.isArray(input)) return [];
  const out: DhcpRange[] = [];
  for (const item of input) {
    const from = normalizeIpv4((item as DhcpRange | null)?.from);
    const to = normalizeIpv4((item as DhcpRange | null)?.to);
    if (from && to) out.push({ from, to });
  }
  return out;
}

// ── Rangs gestionats ────────────────────────────────────────────────────────

/** Xarxa que gestiona aquesta instal·lació: la pestanya IPs la mostra i el rastreig només hi pot entrar. */
export interface ManagedRange {
  name: string;
  /** Primera i última adreça del rang (incloses). */
  from: string;
  to: string;
  /** Si s'ha definit com a CIDR («192.168.1.0/24»), per mostrar-lo igual. */
  cidr: string | null;
}

/** Màxim d'adreces per rang (una /20): la quadrícula i el rastreig no poden anar més enllà. */
export const MAX_RANGE_SIZE = 4096;

export function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

/**
 * Llegeix un rang escrit com a CIDR («192.168.1.0/24»), interval («10.0.0.1-10.0.0.254» o «10.0.0.1-254»)
 * o una sola IP. En un CIDR de /30 o més gran es treuen l'adreça de xarxa i la de difusió.
 */
export function parseRange(text: string): { from: string; to: string; cidr: string | null } | null {
  const value = (text ?? '').trim().replace(/\s+/g, '');
  const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(value);
  if (cidr) {
    const base = ipv4ToNumber(cidr[1]);
    const bits = Number(cidr[2]);
    if (base === null || bits < 8 || bits > 32) return null;
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    const network = (base & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const [first, last] = bits <= 30 ? [network + 1, broadcast - 1] : [network, broadcast];
    return { from: numberToIpv4(first), to: numberToIpv4(last), cidr: `${numberToIpv4(network)}/${bits}` };
  }
  const interval = /^([\d.]+)[-–](\d[\d.]*)$/.exec(value);
  if (interval) {
    const from = normalizeIpv4(interval[1]);
    if (!from) return null;
    // «10.0.0.1-254»: la segona part es completa amb el principi de la primera.
    const tail = interval[2].split('.');
    if (tail.length > 4) return null;
    const to = normalizeIpv4([...from.split('.').slice(0, 4 - tail.length), ...tail].join('.'));
    if (!to) return null;
    const [a, b] = [ipv4ToNumber(from)!, ipv4ToNumber(to)!];
    return { from: numberToIpv4(Math.min(a, b)), to: numberToIpv4(Math.max(a, b)), cidr: null };
  }
  const single = normalizeIpv4(value);
  return single ? { from: single, to: single, cidr: null } : null;
}

export function rangeSize(range: { from: string; to: string }): number {
  const from = ipv4ToNumber(range.from);
  const to = ipv4ToNumber(range.to);
  return from === null || to === null ? 0 : Math.abs(to - from) + 1;
}

/** Rangs gestionats vàlids (des del JSON desat o de la configuració). */
export function cleanManagedRanges(input: unknown): ManagedRange[] {
  if (!Array.isArray(input)) return [];
  const out: ManagedRange[] = [];
  for (const item of input) {
    const row = item as { name?: unknown; cidr?: unknown; from?: unknown; to?: unknown; range?: unknown } | null;
    const text = row?.range ?? row?.cidr ?? (row?.from && row?.to ? `${row.from}-${row.to}` : null);
    const parsed = typeof text === 'string' ? parseRange(text) : null;
    if (!parsed || rangeSize(parsed) > MAX_RANGE_SIZE) continue;
    const name = typeof row?.name === 'string' ? row.name.trim().slice(0, 60) : '';
    out.push({ name: name || parsed.cidr || `${parsed.from} – ${parsed.to}`, ...parsed });
  }
  return out;
}

/** Rang gestionat on cau la IP (null si cap). */
export function managedRangeOf(ip: string, ranges: ManagedRange[]): ManagedRange | null {
  return (dhcpRangeOf(ip, ranges) as ManagedRange | null) ?? null;
}

/** «aa-bb-cc-dd-ee-ff» / «AABB.CCDD.EEFF» → «AA:BB:CC:DD:EE:FF». Null si no és una MAC. */
export function normalizeMac(value: string | null | undefined): string | null {
  const hex = (value ?? '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  return hex.toUpperCase().match(/.{2}/g)!.join(':');
}

/** «2016-05», «05-2016», «2016» → «2016-05» / «2016». Null si no s'entén. */
export function normalizeMonth(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  let match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (match) return month(match[1], match[2]);
  match = /^(\d{1,2})[-/](\d{4})$/.exec(text);
  if (match) return month(match[2], match[1]);
  if (/^\d{4}$/.test(text)) return text;
  return null;
}

function month(year: string, value: string): string | null {
  const m = Number(value);
  return m >= 1 && m <= 12 ? `${year}-${String(m).padStart(2, '0')}` : null;
}

/**
 * Nou estat d'una prova després d'un resultat: cau després de `threshold`
 * fallades seguides i torna a estar bé amb el primer OK.
 */
export function nextCheckState(
  current: { state: CheckState; consecutiveFails: number },
  ok: boolean,
  threshold: number,
): { state: CheckState; consecutiveFails: number; changed: boolean } {
  const limit = Math.max(1, Math.trunc(threshold) || 1);
  if (ok) return { state: 'UP', consecutiveFails: 0, changed: current.state !== 'UP' };
  const fails = current.consecutiveFails + 1;
  const state: CheckState = fails >= limit ? 'DOWN' : current.state === 'DOWN' ? 'DOWN' : current.state;
  return { state, consecutiveFails: fails, changed: state !== current.state };
}

/** Estat de xarxa d'un equip a partir de les seves proves actives. */
export function equipmentNetState(checks: { enabled: boolean; state: CheckState }[]): CheckState | 'NONE' {
  const active = checks.filter((check) => check.enabled);
  if (active.length === 0) return 'NONE';
  if (active.some((check) => check.state === 'DOWN')) return 'DOWN';
  if (active.every((check) => check.state === 'UP')) return 'UP';
  return 'UNKNOWN';
}

/** Dies sencers (pot ser negatiu) des de `now` fins a `date`, comptant dies de calendari UTC. */
export function daysUntil(date: Date, now: Date): number {
  const a = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

/** Zona horària dels resums diaris: APP_TIMEZONE o la del sistema. */
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Dia local («2026-11-09») d'un instant: els resums diaris es tallen a mitjanit local. */
export function localDay(date: Date, timeZone: string = appTimeZone()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ── Alertes ──────────────────────────────────────────────────────────────────

export interface SnapshotEquipment {
  id: string;
  name: string;
  critical: boolean;
  status: 'ACTIVE' | 'SPARE' | 'RETIRED';
  addresses: { ip: string | null; mode: 'STATIC' | 'DHCP' }[];
  checks: {
    id: string;
    kind: 'PING' | 'TCP' | 'HTTP';
    enabled: boolean;
    state: CheckState;
    lastError: string | null;
    certExpiresAt: Date | null;
    label: string;
  }[];
}

export interface SnapshotLicense {
  id: string;
  label: string;
  kind: string;
  seats: number | null;
  expiresAt: Date | null;
  assigned: number;
}

export interface DesiredAlert {
  key: string;
  kind: AlertKind;
  equipmentId?: string;
  licenseId?: string;
  checkId?: string;
  message: string;
}

export function computeAlerts(input: {
  equipment: SnapshotEquipment[];
  licenses: SnapshotLicense[];
  ranges: DhcpRange[];
  licenseWarnDays: number;
  certWarnDays: number;
  now: Date;
}): DesiredAlert[] {
  const out: DesiredAlert[] = [];
  const active = input.equipment.filter((item) => item.status !== 'RETIRED');

  for (const item of active) {
    const enabled = item.checks.filter((check) => check.enabled);
    const down = enabled.filter((check) => check.state === 'DOWN');
    if (item.critical && down.length > 0) {
      const detail = down.map((check) => `${check.label}${check.lastError ? `: ${check.lastError}` : ''}`).join('; ');
      out.push({
        key: `DOWN:${item.id}`,
        kind: 'DOWN',
        equipmentId: item.id,
        checkId: down[0].id,
        message: `${item.name} no respon (${detail}).`,
      });
    }
    for (const check of enabled) {
      if (check.kind !== 'HTTP' || !check.certExpiresAt) continue;
      const days = daysUntil(check.certExpiresAt, input.now);
      if (days <= input.certWarnDays) {
        out.push({
          key: `CERT:${check.id}`,
          kind: 'CERT_EXPIRING',
          equipmentId: item.id,
          checkId: check.id,
          message:
            days < 0
              ? `El certificat HTTPS de ${item.name} (${check.label}) va caducar fa ${-days} dies.`
              : `El certificat HTTPS de ${item.name} (${check.label}) caduca ${days === 0 ? 'avui' : `d'aquí a ${days} dies`}.`,
        });
      }
    }
  }

  // IPs fixes: repetides i dins d'un rang dinàmic.
  const byIp = new Map<string, SnapshotEquipment[]>();
  for (const item of active) {
    for (const address of item.addresses) {
      if (address.mode !== 'STATIC' || !address.ip) continue;
      const list = byIp.get(address.ip) ?? [];
      if (!list.includes(item)) list.push(item);
      byIp.set(address.ip, list);
    }
  }
  for (const [ip, items] of [...byIp.entries()].sort(([a], [b]) => (ipv4ToNumber(a) ?? 0) - (ipv4ToNumber(b) ?? 0) || a.localeCompare(b))) {
    if (items.length > 1) {
      out.push({
        key: `IP_DUPLICATE:${ip}`,
        kind: 'IP_DUPLICATE',
        equipmentId: items[0].id,
        message: `La IP ${ip} està apuntada a ${items.length} equips: ${items.map((item) => item.name).join(', ')}.`,
      });
    }
    const range = dhcpRangeOf(ip, input.ranges);
    if (range) {
      for (const item of items) {
        out.push({
          key: `IP_IN_DHCP:${item.id}:${ip}`,
          kind: 'IP_IN_DHCP',
          equipmentId: item.id,
          message: `${item.name} té la IP fixa ${ip}, dins del rang dinàmic del router (${range.from} – ${range.to}).`,
        });
      }
    }
  }

  for (const license of input.licenses) {
    if (license.expiresAt) {
      const days = daysUntil(license.expiresAt, input.now);
      if (days < 0) {
        out.push({
          key: `LICENSE_EXPIRED:${license.id}`,
          kind: 'LICENSE_EXPIRED',
          licenseId: license.id,
          message: `La llicència ${license.label} va caducar fa ${-days} dies.`,
        });
      } else if (days <= input.licenseWarnDays) {
        out.push({
          key: `LICENSE_EXPIRING:${license.id}`,
          kind: 'LICENSE_EXPIRING',
          licenseId: license.id,
          message: `La llicència ${license.label} caduca ${days === 0 ? 'avui' : `d'aquí a ${days} dies`}.`,
        });
      }
    }
    // En una flotant les places són simultànies: pot estar instal·lada a més equips.
    if (license.kind !== 'FLOATING' && license.seats !== null && license.assigned > license.seats) {
      out.push({
        key: `LICENSE_OVERUSED:${license.id}`,
        kind: 'LICENSE_OVERUSED',
        licenseId: license.id,
        message: `La llicència ${license.label} està assignada a ${license.assigned} equips i només té ${license.seats} places.`,
      });
    }
  }
  return out;
}

/** Text d'una prova per als avisos: «Ping 10.0.0.5», «Port 9100», «HTTP https://…». */
export function checkLabel(check: { kind: 'PING' | 'TCP' | 'HTTP'; port: number | null; url: string | null }, host: string | null): string {
  if (check.kind === 'PING') return `Ping ${host ?? '(sense IP)'}`;
  if (check.kind === 'TCP') return `Port ${check.port ?? '?'}${host ? ` de ${host}` : ''}`;
  return `HTTP ${check.url || (host ? `http://${host}/` : '(sense adreça)')}`;
}
