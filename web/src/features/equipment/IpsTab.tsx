import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, Radar, Settings2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type Equipment, type EquipmentDraft, type EquipmentState, type IpDiscovery, type ManagedRange } from '@/api/equipment';
import { formatDateTime } from './equipmentUi';
import { IpDetail, discoveryShort, draftFromDiscovery } from './IpDetail';

/**
 * Pestanya IPs: les adreces dels rangs que gestiones (Configuració) amb què està ocupat, què és del rang DHCP del
 * router i què queda lliure per assignar com a IP fixa. «Rastreja les lliures» busca aparells a les lliures (ping i
 * ports habituals) i, dels que troba, llança totes les proves d'identificació (DNS, nom de Windows, SNMP, ports,
 * web…). Clic a una casella: detall. Els rangs de més de 256 adreces es mostren per blocs (/24).
 */

type CellKind = 'free' | 'used' | 'router' | 'retired' | 'dhcp' | 'conflict' | 'unknown';

interface Cell {
  host: number;
  ip: string;
  kind: CellKind;
  owners: Equipment[];
  inDhcp: boolean;
  via?: string;
}

const KIND_STYLE: Record<CellKind, string> = {
  free: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  used: 'border-ink-200 bg-ink-100 text-ink-700 hover:bg-ink-200',
  router: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
  retired: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
  dhcp: 'border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100',
  conflict: 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200',
  unknown: 'border-orange-400 bg-orange-200 text-orange-900 ring-2 ring-orange-300 hover:bg-orange-300',
};

const KIND_LABEL: Record<CellKind, string> = {
  free: 'Lliure',
  used: 'Ocupada',
  router: 'Router (porta d’enllaç)',
  retired: 'D’un equip de baixa',
  dhcp: 'Rang DHCP del router',
  conflict: 'Repetida o dins del DHCP',
  unknown: 'Respon i no és a l’inventari',
};

/** Identificacions alhora després d'un rastreig (cadascuna obre ~30 connexions). */
const IDENTIFY_CONCURRENCY = 3;
/** IPs per petició de rastreig (el servidor n'admet com a molt 1024). */
const SCAN_CHUNK = 1024;

function ipNumber(ip: string): number {
  return ip.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

function numberIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function rangeKey(range: Pick<ManagedRange, 'from' | 'to'>) {
  return `${range.from}-${range.to}`;
}

export function IpsTab({
  state,
  onOpenEquipment,
  onCreate,
  onOpenSettings,
}: {
  state: EquipmentState;
  onOpenEquipment: (id: string) => void;
  onCreate: (draft: EquipmentDraft) => void;
  onOpenSettings: () => void;
}) {
  const manager = state.access.manager;
  const configured = state.settings.managedRanges;

  // Sense rangs a Configuració: les /24 que surten a l'inventari (la que té més equips primer).
  const ranges = useMemo<ManagedRange[]>(() => {
    if (configured.length) return configured;
    const count = new Map<string, number>();
    for (const item of state.equipment) {
      for (const address of item.addresses) {
        if (!address.ip || !/^\d+\.\d+\.\d+\.\d+$/.test(address.ip)) continue;
        const prefix = address.ip.split('.').slice(0, 3).join('.');
        count.set(prefix, (count.get(prefix) ?? 0) + 1);
      }
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([prefix]) => ({ name: `${prefix}.0/24 (de l’inventari)`, from: `${prefix}.1`, to: `${prefix}.254`, cidr: `${prefix}.0/24` }));
  }, [configured, state.equipment]);

  const [rangeId, setRangeId] = useState<string>(() => (ranges[0] ? rangeKey(ranges[0]) : ''));
  const range = ranges.find((item) => rangeKey(item) === rangeId) ?? ranges[0] ?? null;
  useEffect(() => {
    if (range && rangeKey(range) !== rangeId) setRangeId(rangeKey(range));
  }, [range, rangeId]);

  // Blocs de com a molt 256 adreces (una /24) dins del rang.
  const blocks = useMemo(() => {
    if (!range) return [];
    const from = ipNumber(range.from);
    const to = ipNumber(range.to);
    const out: { from: number; to: number; label: string }[] = [];
    for (let start = from; start <= to; start = (Math.floor(start / 256) + 1) * 256) {
      const end = Math.min(to, Math.floor(start / 256) * 256 + 255);
      out.push({ from: start, to: end, label: `${numberIp(start).split('.').slice(0, 3).join('.')}.x` });
    }
    return out;
  }, [range]);
  const [blockIndex, setBlockIndex] = useState(0);
  useEffect(() => setBlockIndex(0), [rangeId]);
  const block = blocks[Math.min(blockIndex, blocks.length - 1)] ?? null;

  const [onlyFree, setOnlyFree] = useState(false);
  const [responding, setResponding] = useState<Map<string, string>>(() => new Map());
  const [scanInfo, setScanInfo] = useState<{ key: string; at: string; scanned: number; unavailable: boolean } | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [discoveries, setDiscoveries] = useState<Record<string, IpDiscovery>>({});
  const [identifying, setIdentifying] = useState<Set<string>>(() => new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const owners = useMemo(() => {
    const map = new Map<string, Equipment[]>();
    for (const item of state.equipment) {
      for (const address of item.addresses) {
        if (!address.ip) continue;
        const list = map.get(address.ip) ?? [];
        if (!list.includes(item)) list.push(item);
        map.set(address.ip, list);
      }
    }
    return map;
  }, [state.equipment]);

  const dhcp = useMemo(() => state.settings.dhcpRanges.map((item) => [ipNumber(item.from), ipNumber(item.to)] as const), [state.settings]);

  /** Totes les caselles del rang (per comptar i per rastrejar). */
  const allCells = useMemo(() => {
    if (!range) return [];
    const out: Cell[] = [];
    for (let value = ipNumber(range.from); value <= ipNumber(range.to); value += 1) {
      const ip = numberIp(value);
      const host = value & 255;
      const list = owners.get(ip) ?? [];
      const active = list.filter((item) => item.status !== 'RETIRED');
      const inDhcp = dhcp.some(([from, to]) => value >= Math.min(from, to) && value <= Math.max(from, to));
      // Una IP d'un equip DHCP dins del rang és normal; una de fixa dins del rang o repetida és un conflicte.
      const staticInDhcp = inDhcp && active.some((item) => item.addresses.some((address) => address.ip === ip && address.mode === 'STATIC'));
      let kind: CellKind;
      if (active.length > 1 || staticInDhcp) kind = 'conflict';
      else if (active.length === 1) kind = 'used';
      else if (list.length) kind = 'retired';
      else if (inDhcp) kind = 'dhcp';
      // La .1 és la porta d'enllaç habitual: no s'ofereix com a lliure encara que no sigui a l'inventari.
      else if (host === 1) kind = 'router';
      // Adreces de xarxa i de difusió d'una /24 (només si el rang les inclou).
      else if (host === 0 || host === 255) kind = 'router';
      else kind = 'free';
      const found = responding.has(ip) || !!discoveries[ip]?.alive;
      if ((kind === 'free' || kind === 'retired') && found) kind = 'unknown';
      out.push({ host, ip, kind, owners: list, inDhcp, via: responding.get(ip) });
    }
    return out;
  }, [range, owners, dhcp, responding, discoveries]);

  const cells = useMemo(
    () => (block ? allCells.filter((cell) => ipNumber(cell.ip) >= block.from && ipNumber(cell.ip) <= block.to) : []),
    [allCells, block],
  );

  const counts = useMemo(() => {
    const total: Record<CellKind, number> = { free: 0, used: 0, router: 0, retired: 0, dhcp: 0, conflict: 0, unknown: 0 };
    for (const cell of allCells) total[cell.kind] += 1;
    return total;
  }, [allCells]);
  const firstFree = allCells.find((cell) => cell.kind === 'free');
  const scanFresh = !!range && scanInfo?.key === rangeKey(range);
  const selectedCell = allCells.find((cell) => cell.ip === selected) ?? null;

  async function copy(ip: string) {
    try {
      await navigator.clipboard?.writeText(ip);
    } catch {
      // Sense porta-retalls (http): l'IP es veu igualment a la pantalla.
    }
    setCopied(ip);
    window.setTimeout(() => setCopied((current) => (current === ip ? null : current)), 1500);
  }

  async function identify(ip: string) {
    setIdentifying((current) => new Set(current).add(ip));
    try {
      const result = await equipmentApi.identify(ip);
      setDiscoveries((current) => ({ ...current, [ip]: result }));
    } catch (err) {
      setError(`${ip}: ${readError(err)}`);
    } finally {
      setIdentifying((current) => {
        const next = new Set(current);
        next.delete(ip);
        return next;
      });
    }
  }

  async function runScan() {
    if (!range) return;
    const key = rangeKey(range);
    setError(null);
    const targets = allCells.filter((cell) => cell.kind === 'free' || cell.kind === 'retired' || cell.kind === 'unknown').map((cell) => cell.ip);
    if (!targets.length) return;
    setScanning({ done: 0, total: targets.length });
    const found: { ip: string; via: string }[] = [];
    let unavailable = false;
    try {
      for (let index = 0; index < targets.length; index += SCAN_CHUNK) {
        const chunk = targets.slice(index, index + SCAN_CHUNK);
        const result = await equipmentApi.scan(chunk);
        found.push(...result.responding);
        unavailable = unavailable || result.unavailable;
        setScanning({ done: Math.min(targets.length, index + chunk.length), total: targets.length });
      }
      setResponding((current) => {
        const next = new Map(current);
        for (const ip of targets) next.delete(ip);
        for (const row of found) next.set(row.ip, row.via);
        return next;
      });
      setScanInfo({ key, at: new Date().toISOString(), scanned: targets.length, unavailable: unavailable && !found.length });
      setScanning(null);
      // Dels que hi són, totes les proves: es van omplint a mesura que acaben.
      const queue = found.map((row) => row.ip);
      if (!queue.length) return;
      setBatch({ done: 0, total: queue.length });
      let next = 0;
      const worker = async () => {
        while (next < queue.length) {
          await identify(queue[next++]);
          setBatch((current) => (current ? { ...current, done: current.done + 1 } : current));
        }
      };
      await Promise.all(Array.from({ length: Math.min(IDENTIFY_CONCURRENCY, queue.length) }, worker));
      setBatch(null);
    } catch (err) {
      setError(readError(err));
    } finally {
      setScanning(null);
    }
  }

  function pick(cell: Cell) {
    setSelected(cell.ip);
    const index = blocks.findIndex((item) => ipNumber(cell.ip) >= item.from && ipNumber(cell.ip) <= item.to);
    if (index >= 0) setBlockIndex(index);
    window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  function title(cell: Cell): string {
    const lines = [cell.ip, KIND_LABEL[cell.kind]];
    for (const item of cell.owners) lines.push(`${item.name}${item.status === 'RETIRED' ? ' (de baixa)' : ''}`);
    if (cell.inDhcp && cell.kind !== 'dhcp') lines.push('Dins del rang DHCP del router');
    if (cell.via) lines.push(`Respon (${cell.via})`);
    const found = discoveries[cell.ip];
    if (found?.alive) lines.push(`${found.guess.label}${found.names[0] ? ` · ${found.names[0].name}` : ''}`);
    lines.push('Clic: detall i identificació');
    return lines.join('\n');
  }

  if (!range) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-ink-900">Quines xarxes gestiones?</h2>
        <p className="mt-1 text-sm text-ink-600">
          Afegeix els teus rangs d’IP a Configuració (per exemple <span className="font-mono">192.168.1.0/24</span> o{' '}
          <span className="font-mono">10.0.0.1-10.0.0.254</span>). La pestanya IPs els mostrarà i el rastreig només hi entrarà a ells.
        </p>
        <button type="button" onClick={onOpenSettings} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          <Settings2 size={16} /> Configura els rangs
        </button>
      </div>
    );
  }

  const unknownCells = allCells.filter((cell) => cell.kind === 'unknown');
  const shown = onlyFree ? cells.filter((cell) => cell.kind === 'free' || cell.kind === 'unknown') : cells;
  const busy = scanning !== null || batch !== null;

  return (
    <div className="space-y-4">
      {!configured.length ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          Es mostren les xarxes que surten a l’inventari. Defineix les que gestiones per triar-les tu i limitar-hi el rastreig.
          <button type="button" onClick={onOpenSettings} className="font-semibold underline">
            Configuració
          </button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <select value={rangeKey(range)} onChange={(event) => setRangeId(event.target.value)} className="h-9 max-w-xs rounded-lg border border-ink-200 bg-white px-2 text-sm font-medium" aria-label="Rang">
          {ranges.map((item) => (
            <option key={rangeKey(item)} value={rangeKey(item)}>
              {item.name}
              {item.cidr && item.name !== item.cidr ? ` · ${item.cidr}` : !item.cidr ? ` · ${item.from} – ${item.to}` : ''}
            </option>
          ))}
        </select>
        {blocks.length > 1 ? (
          <select value={blockIndex} onChange={(event) => setBlockIndex(Number(event.target.value))} className="h-9 rounded-lg border border-ink-200 bg-white px-2 font-mono text-sm" aria-label="Bloc">
            {blocks.map((item, index) => (
              <option key={item.label} value={index}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}
        {firstFree ? (
          <button
            type="button"
            onClick={() => void copy(firstFree.ip)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            title="Copia l’IP"
          >
            Primera lliure: <span className="font-mono">{firstFree.ip}</span>
            {copied === firstFree.ip ? <Check size={15} /> : <Copy size={15} />}
          </button>
        ) : (
          <span className="text-sm text-red-700">No queda cap IP lliure fora del DHCP en aquest rang.</span>
        )}
        <label className="inline-flex items-center gap-1.5 text-sm text-ink-700">
          <input type="checkbox" checked={onlyFree} onChange={(event) => setOnlyFree(event.target.checked)} /> Només les lliures
        </label>
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={busy}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
          title="Busca aparells a les IPs lliures i a les dels equips de baixa de tot el rang (ping i ports habituals) i identifica els que troba"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Radar size={16} />}
          {scanning
            ? `Rastrejant ${scanning.done}/${scanning.total}…`
            : batch
              ? `Identificant ${batch.done}/${batch.total}…`
              : 'Rastreja les lliures'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(KIND_LABEL) as CellKind[]).map((kind) =>
          kind === 'unknown' && !counts.unknown ? null : (
            <span key={kind} className={clsx('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium', KIND_STYLE[kind])}>
              {KIND_LABEL[kind]} <strong>{counts[kind]}</strong>
            </span>
          ),
        )}
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {scanFresh && scanInfo ? (
        scanInfo.unavailable ? (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert size={16} /> El servidor no té permís per fer ping i no ha trobat res pels ports: la comprovació no és fiable.
          </p>
        ) : (
          <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            Rastrejades {scanInfo.scanned} IPs el {formatDateTime(scanInfo.at)} (ping i ports habituals).{' '}
            {unknownCells.length ? (
              <>
                <strong className="text-orange-800">{unknownCells.length} tenen un aparell que no és a l’inventari</strong>: no les assignis fins saber què són
                {manager ? ' (des del detall, «Dona d’alta»)' : ''}.
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {unknownCells.map((cell) => {
                    const found = discoveries[cell.ip];
                    return (
                      <button
                        key={cell.ip}
                        type="button"
                        onClick={() => pick(cell)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-white px-2 py-1 text-xs text-orange-900 hover:bg-orange-50"
                      >
                        <span className="font-mono font-semibold">{cell.ip}</span>
                        {identifying.has(cell.ip) ? <Loader2 size={12} className="animate-spin" /> : found ? <span>{discoveryShort(found)}</span> : null}
                        {found?.alive && found.names[0] && found.guess.label !== 'Desconegut' ? <span className="text-orange-700">· {found.guess.label}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              'No hi ha res a les lliures: es poden assignar.'
            )}{' '}
            <span className="text-xs text-ink-500">Un aparell apagat no respon: no és una garantia del tot.</span>
          </div>
        )
      ) : null}

      {selectedCell ? (
        <div ref={detailRef}>
          <IpDetail
            ip={selectedCell.ip}
            kindLabel={`${KIND_LABEL[selectedCell.kind]}${selectedCell.inDhcp && selectedCell.kind !== 'dhcp' ? ' · dins del rang DHCP' : ''}${selectedCell.via ? ` · respon (${selectedCell.via})` : ''}`}
            owners={selectedCell.owners}
            discovery={discoveries[selectedCell.ip]}
            identifying={identifying.has(selectedCell.ip)}
            copied={copied === selectedCell.ip}
            manager={manager}
            onIdentify={() => void identify(selectedCell.ip)}
            onCopy={() => void copy(selectedCell.ip)}
            onOpenEquipment={onOpenEquipment}
            onCreate={
              selectedCell.owners.some((item) => item.status !== 'RETIRED') || !discoveries[selectedCell.ip]
                ? null
                : () => onCreate(draftFromDiscovery(discoveries[selectedCell.ip], state))
            }
            onClose={() => setSelected(null)}
          />
        </div>
      ) : null}

      <div className={clsx('grid gap-1', onlyFree ? 'grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]' : 'grid-cols-8 sm:grid-cols-12 lg:grid-cols-[repeat(16,minmax(0,1fr))]')}>
        {shown.map((cell) => {
          const found = discoveries[cell.ip];
          const caption = cell.owners[0]?.name ?? (found ? discoveryShort(found) : null);
          return (
            <button
              key={cell.ip}
              type="button"
              onClick={() => pick(cell)}
              title={title(cell)}
              className={clsx(
                'relative flex h-11 flex-col items-center justify-center rounded-md border text-xs leading-tight transition-colors',
                KIND_STYLE[cell.kind],
                selected === cell.ip && 'outline outline-2 outline-offset-1 outline-brand-500',
              )}
            >
              <span className="font-mono font-semibold">{onlyFree ? cell.ip : cell.host}</span>
              {!onlyFree && caption ? <span className="max-w-full truncate px-0.5 text-[10px] opacity-80">{caption}</span> : null}
              {identifying.has(cell.ip) ? <Loader2 size={11} className="absolute right-0.5 top-0.5 animate-spin" /> : null}
              {copied === cell.ip ? <Check size={12} className="absolute right-0.5 top-0.5" /> : null}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-500">
        Lliure = cap equip de l’inventari la fa servir i és fora dels rangs DHCP del router (Configuració). Clic en qualsevol casella: detall, copiar l’IP i
        «Identifica» (DNS, nom de Windows i MAC, SNMP, ports, web i serveis; només lectura).
      </p>
    </div>
  );
}
