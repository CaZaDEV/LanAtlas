import { useState, type ReactNode } from 'react';
import {
  Box,
  Camera,
  Cctv,
  Cpu,
  Eye,
  EyeOff,
  Factory,
  Fingerprint,
  HardDrive,
  Laptop,
  Loader2,
  Monitor,
  Network,
  Phone,
  Printer,
  Router,
  Server,
  Smartphone,
  Tablet,
  Thermometer,
  Tv,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import type {
  AlertKind,
  CheckKind,
  Equipment,
  EquipmentLicense,
  EquipmentStatus,
  EquipmentType,
  LicenseKind,
  NetState,
  Ownership,
} from '@/api/equipment';

export { ErrorNote, Field, GhostButton, Modal, PrimaryButton } from '@/components/ui';

/** Icones que es poden triar per a un tipus d'equip (nom Lucide → component). */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  monitor: Monitor,
  laptop: Laptop,
  server: Server,
  printer: Printer,
  factory: Factory,
  fingerprint: Fingerprint,
  router: Router,
  cctv: Cctv,
  cpu: Cpu,
  box: Box,
  'hard-drive': HardDrive,
  network: Network,
  wifi: Wifi,
  camera: Camera,
  tablet: Tablet,
  smartphone: Smartphone,
  phone: Phone,
  tv: Tv,
  zap: Zap,
  thermometer: Thermometer,
};

export function TypeIcon({ type, size = 16 }: { type: Pick<EquipmentType, 'icon' | 'color'> | undefined; size?: number }) {
  const Icon = (type && TYPE_ICONS[type.icon]) || Box;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg text-white"
      style={{ background: type?.color ?? '#64748b', width: size + 14, height: size + 14 }}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  );
}

export const OWNERSHIP_LABEL: Record<Ownership, string> = { COMPANY: 'Empresa', PERSONAL: 'Particular' };
export const STATUS_LABEL: Record<EquipmentStatus, string> = { ACTIVE: 'En ús', SPARE: 'Reserva', RETIRED: 'De baixa' };
export const LICENSE_KIND_LABEL: Record<LicenseKind, string> = {
  PERPETUAL: 'Perpètua',
  SUBSCRIPTION: 'Subscripció',
  OEM: 'OEM',
  FLOATING: 'Flotant',
  FIXED: 'Fixa',
  OTHER: 'Altres',
};
export const CHECK_KIND_LABEL: Record<CheckKind, string> = { PING: 'Ping', TCP: 'Port TCP', HTTP: 'Web (HTTP/HTTPS)' };
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  DOWN: 'Equip caigut',
  LICENSE_EXPIRING: 'Llicència per caducar',
  LICENSE_EXPIRED: 'Llicència caducada',
  LICENSE_OVERUSED: 'Llicència amb massa equips',
  CERT_EXPIRING: 'Certificat per caducar',
  IP_DUPLICATE: 'IP repetida',
  IP_IN_DHCP: 'IP fixa al rang DHCP',
};

const NET: Record<NetState, { label: string; dot: string; text: string }> = {
  UP: { label: 'Respon', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  DOWN: { label: 'No respon', dot: 'bg-red-500', text: 'text-danger' },
  UNKNOWN: { label: 'Comprovant', dot: 'bg-amber-400', text: 'text-amber-700' },
  NONE: { label: 'Sense proves', dot: 'bg-ink-300', text: 'text-ink-500' },
};

export function NetDot({ state, withLabel, pulse }: { state: NetState; withLabel?: boolean; pulse?: boolean }) {
  const info = NET[state];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', info.text)} title={info.label}>
      <span className="relative inline-flex h-2.5 w-2.5">
        {pulse && state === 'DOWN' ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /> : null}
        <span className={clsx('relative inline-flex h-2.5 w-2.5 rounded-full', info.dot)} />
      </span>
      {withLabel ? info.label : <span className="sr-only">{info.label}</span>}
    </span>
  );
}

/** IP principal per mostrar a la llista: la primera fixa, o «DHCP». */
export function primaryAddress(item: Pick<Equipment, 'addresses'>): string {
  const fixed = item.addresses.find((address) => address.mode === 'STATIC' && address.ip);
  if (fixed?.ip) return fixed.ip;
  if (item.addresses.some((address) => address.mode === 'DHCP')) return 'DHCP';
  return '—';
}

export function assigneeName(item: Pick<Equipment, 'assignedName'>): string | null {
  return item.assignedName ?? null;
}

export function licenseLabel(license: Pick<EquipmentLicense, 'product' | 'version'>): string {
  return [license.product, license.version].filter(Boolean).join(' ');
}

/** Treu accents i passa a minúscules per cercar «Merce» i trobar «Mercè». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Text on busca el cercador: tots els camps visibles de l'equip, el tipus, els
 * programes i les llicències. Mai els secrets.
 */
export function searchHaystack(item: Equipment, types: Map<string, EquipmentType>, licenses: Map<string, EquipmentLicense>): string {
  const parts: (string | null | undefined)[] = [
    item.number,
    item.number ? `pc${item.number}` : null,
    item.name,
    types.get(item.typeId)?.name,
    item.brand,
    item.model,
    item.serial,
    item.acquired,
    item.location,
    item.os,
    assigneeName(item),
    OWNERSHIP_LABEL[item.ownership],
    STATUS_LABEL[item.status],
    item.notes,
    item.reviewNote,
    ...item.addresses.flatMap((address) => [address.ip, address.label, address.mac, address.mac?.replace(/:/g, ''), address.mode === 'DHCP' ? 'dhcp' : null]),
    ...item.software.flatMap((row) => [row.name, row.version]),
    ...item.licenseIds.flatMap((id) => {
      const license = licenses.get(id);
      return license ? [license.product, license.version, license.vendor, license.keyHint] : [];
    }),
  ];
  return fold(parts.filter(Boolean).join(' · '));
}

/** Totes les paraules han d'aparèixer (en qualsevol camp). */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function since(value: string | null | undefined): string {
  if (!value) return '';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'ara mateix';
  if (minutes < 60) return `fa ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `fa ${hours} h`;
  return `fa ${Math.round(hours / 24)} dies`;
}

let currency = 'EUR';
/** Moneda de Configuració (la fixa EquipmentPage en carregar l'estat). */
export function setCurrency(code: string) {
  currency = code || 'EUR';
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Dies fins a una data (YYYY-MM-DD o ISO); negatiu si ja ha passat. */
export function daysTo(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value.slice(0, 10) + 'T00:00:00Z').getTime();
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function inputClass(extra?: string) {
  return clsx(
    'h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100',
    extra,
  );
}

/** Valor sensible ocult amb «Mostra» (el servidor el desxifra només quan es demana). */
export function SecretValue({ reveal, hint }: { reveal: () => Promise<string>; hint?: string | null }) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function show() {
    if (value !== null) return setValue(null);
    setLoading(true);
    setError(null);
    try {
      setValue(await reveal());
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <code className="min-w-0 whitespace-pre-wrap break-all rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-800">
        {value ?? (hint ? `•••• ${hint}` : '••••••••')}
      </code>
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
        title={value === null ? 'Mostra' : 'Amaga'}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : value === null ? <Eye size={13} /> : <EyeOff size={13} />}
        {value === null ? 'Mostra' : 'Amaga'}
      </button>
      {value !== null ? (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="text-xs font-medium text-ink-600 hover:underline"
        >
          {copied ? 'Copiat' : 'Copia'}
        </button>
      ) : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}

export function Pill({ children, tone = 'ink', title }: { children: ReactNode; tone?: 'ink' | 'amber' | 'red' | 'emerald' | 'brand' | 'violet'; title?: string }) {
  const tones = {
    ink: 'bg-ink-100 text-ink-700',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    red: 'bg-red-50 text-danger ring-1 ring-inset ring-red-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100',
    violet: 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200',
  } as const;
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', tones[tone])}>
      {children}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{children}</h3>
      {action}
    </div>
  );
}
