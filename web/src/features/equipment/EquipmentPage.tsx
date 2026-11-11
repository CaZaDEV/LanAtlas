import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Map as MapIcon,
  MapPin,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  MonitorCog,
  Network,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { motion } from 'motion/react';

import { readError } from '@/api/client';
import { equipmentApi, type Equipment, type EquipmentDraft, type NetState } from '@/api/equipment';
import { AlertsTab } from './AlertsTab';
import { EquipmentDialog } from './EquipmentDialog';
import { EquipmentPanel } from './EquipmentPanel';
import { IpsTab } from './IpsTab';
import { LicensesTab } from './LicensesTab';
import { MapTab, type MapRequest } from './MapTab';
import { SettingsTab } from './SettingsTab';
import { exportEquipment } from './exportEquipment';
import {
  NetDot,
  OWNERSHIP_LABEL,
  Pill,
  STATUS_LABEL,
  TypeIcon,
  assigneeName,
  daysTo,
  matchesQuery,
  primaryAddress,
  searchHaystack,
  setCurrency,
} from './equipmentUi';

type TabKey = 'equips' | 'mapa' | 'ips' | 'llicencies' | 'alertes' | 'configuracio';

const TABS: { key: TabKey; label: string; icon: LucideIcon; manager?: boolean }[] = [
  { key: 'equips', label: 'Equips', icon: MonitorCog },
  { key: 'mapa', label: 'Mapa', icon: MapIcon },
  { key: 'ips', label: 'IPs', icon: Network },
  { key: 'llicencies', label: 'Llicències', icon: KeyRound },
  { key: 'alertes', label: 'Alertes', icon: BellRing },
  { key: 'configuracio', label: 'Configuració', icon: Settings2, manager: true },
];

type NetFilter = 'all' | NetState;
type Scope = 'company' | 'all' | 'personal' | 'review' | 'retired';

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'company', label: 'Empresa' },
  { key: 'all', label: 'Tots' },
  { key: 'personal', label: 'Particulars' },
  { key: 'review', label: 'A revisar' },
  { key: 'retired', label: 'De baixa' },
];

type Dialog = { kind: 'equipment'; item?: Equipment; draft?: EquipmentDraft } | null;

/** Pàgina principal de LanAtlas: equips, mapa, IPs, llicències, alertes i configuració. */
export function EquipmentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['equipment', 'state'], queryFn: equipmentApi.state, refetchInterval: 30_000 });
  const state = query.data;
  const manager = !!state?.access.manager;
  if (state) setCurrency(state.settings.currency);
  const tab = (TABS.find((item) => item.key === searchParams.get('tab') && (!item.manager || manager))?.key ?? 'equips') as TabKey;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [netFilter, setNetFilter] = useState<NetFilter>('all');
  const [scope, setScope] = useState<Scope>('company');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('equip'));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null);

  const types = useMemo(() => new Map((state?.types ?? []).map((type) => [type.id, type])), [state]);
  const licenses = useMemo(() => new Map((state?.licenses ?? []).map((license) => [license.id, license])), [state]);
  const haystacks = useMemo(
    () => new Map((state?.equipment ?? []).map((item) => [item.id, searchHaystack(item, types, licenses)])),
    [state, types, licenses],
  );

  const filtered = useMemo(() => {
    const list = state?.equipment ?? [];
    return list.filter((item) => {
      if (search.trim()) {
        // Amb una cerca es busca a tot arreu (també particulars i de baixa).
        if (!matchesQuery(haystacks.get(item.id) ?? '', search)) return false;
      } else if (scope === 'company' && (item.ownership !== 'COMPANY' || item.status === 'RETIRED')) return false;
      else if (scope === 'all' && item.status === 'RETIRED') return false;
      else if (scope === 'personal' && item.ownership !== 'PERSONAL') return false;
      else if (scope === 'review' && !item.needsReview) return false;
      else if (scope === 'retired' && item.status !== 'RETIRED') return false;
      if (typeFilter !== 'all' && item.typeId !== typeFilter) return false;
      if (netFilter !== 'all' && item.netState !== netFilter) return false;
      return true;
    });
  }, [state, search, scope, typeFilter, netFilter, haystacks]);

  const stats = useMemo(() => {
    const list = (state?.equipment ?? []).filter((item) => item.status !== 'RETIRED');
    return {
      total: list.filter((item) => item.ownership === 'COMPANY').length,
      down: list.filter((item) => item.netState === 'DOWN').length,
      criticalDown: list.filter((item) => item.netState === 'DOWN' && item.critical).length,
      alerts: (state?.alerts ?? []).filter((alert) => !alert.closedAt).length,
      unacked: (state?.alerts ?? []).filter((alert) => !alert.closedAt && !alert.ackedAt).length,
      expiring: (state?.licenses ?? []).filter((license) => {
        const days = daysTo(license.expiresAt);
        return days !== null && days <= (state?.settings?.licenseWarnDays ?? 30);
      }).length,
      review: list.filter((item) => item.needsReview).length,
    };
  }, [state]);

  const selected = selectedId ? state?.equipment.find((item) => item.id === selectedId) ?? null : null;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['equipment', 'state'] });
  }

  function go(next: TabKey) {
    setSearchParams(next === 'equips' ? {} : { tab: next }, { replace: true });
  }

  function openEquipment(id: string) {
    go('equips');
    setSelectedId(id);
  }

  function openOnMap(id: string, place: boolean) {
    setMapRequest({ id, place, token: Date.now() });
    go('mapa');
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-white px-4 py-2 sm:px-6 lg:px-8">
        <span className="mr-2 inline-flex items-center gap-2 font-semibold text-ink-900">
          <img src="/favicon.svg" alt="" className="h-7 w-7" /> LanAtlas
        </span>
        <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-ink-100 p-1" aria-label="Apartats d’equips">
          {TABS.filter((item) => !item.manager || manager).map((item) => {
            const Icon = item.icon;
            const current = item.key === tab;
            const badge = item.key === 'alertes' ? stats.unacked : 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item.key)}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                  current ? 'text-brand-700' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {current ? (
                  <motion.span layoutId="equipment-tab" className="absolute inset-0 rounded-md bg-white shadow-sm" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />
                ) : null}
                <Icon size={15} aria-hidden="true" className="relative" />
                <span className="relative">{item.label}</span>
                {badge ? <span className="relative rounded-full bg-danger px-1.5 text-xs font-bold text-white">{badge}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state && tab === 'equips' ? (
            <button
              type="button"
              onClick={() => exportEquipment(filtered, types, licenses, manager)}
              title="Descarrega a Excel els equips que es veuen a la llista"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-emerald-700 shadow-sm ring-1 ring-ink-200 hover:bg-emerald-50"
            >
              <FileSpreadsheet size={16} /> Excel
            </button>
          ) : null}
          {manager && tab === 'equips' ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'equipment' })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              <Plus size={16} /> Nou equip
            </button>
          ) : null}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto bg-ink-50 px-4 py-4 sm:px-6 lg:px-8">
        {query.isLoading ? (
          <div className="grid h-64 place-items-center text-ink-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : query.isError ? (
          <p className="rounded-lg bg-danger/5 p-3 text-sm text-danger">{readError(query.error)}</p>
        ) : state ? (
          <>
            <div className={clsx('mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5', (tab === 'mapa' || tab === 'ips') && 'hidden')}>
              <Stat icon={MonitorCog} label="Equips de l’empresa" value={String(stats.total)} tone="brand" onClick={() => { go('equips'); setScope('company'); setNetFilter('all'); }} />
              <Stat
                icon={WifiOff}
                label={stats.criticalDown ? `No responen (${stats.criticalDown} crítics)` : 'No responen'}
                value={String(stats.down)}
                tone={stats.criticalDown ? 'danger' : stats.down ? 'amber' : 'emerald'}
                onClick={() => { go('equips'); setScope('all'); setNetFilter('DOWN'); }}
              />
              <Stat icon={ShieldAlert} label="Alertes obertes" value={String(stats.alerts)} tone={stats.alerts ? 'danger' : 'emerald'} onClick={() => go('alertes')} />
              <Stat icon={KeyRound} label="Llicències per caducar" value={String(stats.expiring)} tone={stats.expiring ? 'amber' : 'emerald'} onClick={() => go('llicencies')} />
              <Stat icon={TriangleAlert} label="Fitxes a revisar" value={String(stats.review)} tone={stats.review ? 'amber' : 'emerald'} onClick={() => { go('equips'); setScope('review'); setNetFilter('all'); }} />
            </div>

            {tab === 'equips' ? (
              <div className="flex gap-4">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative min-w-[16rem] flex-1 sm:max-w-md">
                      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Busca per número, IP, MAC, programa, persona, ubicació…"
                        autoFocus
                        className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      />
                      {search ? (
                        <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label="Esborra la cerca">
                          <X size={15} />
                        </button>
                      ) : null}
                    </label>
                    <select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                      className="h-10 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 outline-none focus:border-brand-400"
                      aria-label="Tipus"
                    >
                      <option value="all">Tots els tipus</option>
                      {state.types.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={netFilter}
                      onChange={(event) => setNetFilter(event.target.value as NetFilter)}
                      className="h-10 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 outline-none focus:border-brand-400"
                      aria-label="Estat de xarxa"
                    >
                      <option value="all">Qualsevol estat</option>
                      <option value="UP">Responen</option>
                      <option value="DOWN">No responen</option>
                      <option value="UNKNOWN">Comprovant</option>
                      <option value="NONE">Sense proves</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {SCOPES.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setScope(item.key)}
                        aria-pressed={scope === item.key && !search.trim()}
                        disabled={!!search.trim()}
                        className={clsx(
                          'h-8 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50',
                          scope === item.key && !search.trim() ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                    <span className="ml-2 text-xs text-ink-500">
                      {filtered.length} {filtered.length === 1 ? 'equip' : 'equips'}
                      {search.trim() ? ' · la cerca mira a tot arreu' : ''}
                    </span>
                  </div>

                  <EquipmentTable items={filtered} types={types} selectedId={selectedId} onSelect={(id) => setSelectedId((current) => (current === id ? null : id))} />
                </div>

                {selected ? (
                  <div className="fixed inset-x-0 bottom-0 z-40 h-[80vh] p-2 lg:sticky lg:top-0 lg:z-auto lg:h-[calc(100vh-11rem)] lg:w-[26rem] lg:shrink-0 lg:p-0">
                    <EquipmentPanel
                      item={selected}
                      state={state}
                      onClose={() => setSelectedId(null)}
                      onEdit={() => setDialog({ kind: 'equipment', item: selected })}
                      onChanged={refresh}
                      mapActions={
                        selected.mapX !== null || manager ? (
                          <button
                            type="button"
                            onClick={() => openOnMap(selected.id, selected.mapX === null)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
                          >
                            {selected.mapX !== null ? <MapIcon size={14} /> : <MapPin size={14} />}
                            {selected.mapX !== null ? `Veure al mapa${selected.mapCode ? ` (màquina ${selected.mapCode})` : ''}` : 'Ubica al mapa'}
                          </button>
                        ) : null
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : tab === 'mapa' ? (
              <MapTab
                state={state}
                request={mapRequest}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onEdit={(item) => setDialog({ kind: 'equipment', item })}
                onChanged={refresh}
              />
            ) : tab === 'ips' ? (
              <IpsTab state={state} onOpenEquipment={openEquipment} onCreate={(draft) => setDialog({ kind: 'equipment', draft })} onOpenSettings={() => go('configuracio')} />
            ) : tab === 'llicencies' ? (
              <LicensesTab state={state} onChanged={refresh} onOpenEquipment={openEquipment} />
            ) : tab === 'alertes' ? (
              <AlertsTab state={state} onChanged={refresh} onOpenEquipment={openEquipment} onOpenLicenses={() => go('llicencies')} />
            ) : (
              <SettingsTab state={state} onChanged={refresh} />
            )}
          </>
        ) : null}
      </section>

      {state && dialog?.kind === 'equipment' ? (
        <EquipmentDialog
          item={dialog.item}
          draft={dialog.draft}
          state={state}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            setSelectedId(id);
            refresh();
          }}
          onDeleted={() => {
            setDialog(null);
            setSelectedId(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function EquipmentTable({
  items,
  types,
  selectedId,
  onSelect,
}: {
  items: Equipment[];
  types: Map<string, import('@/api/equipment').EquipmentType>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">Cap equip coincideix amb la cerca o els filtres.</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="hidden bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 md:table-header-group">
          <tr>
            <th className="w-8 px-3 py-2" aria-label="Estat" />
            <th className="px-3 py-2">Equip</th>
            <th className="px-3 py-2">IP</th>
            <th className="hidden px-3 py-2 xl:table-cell">Ubicació</th>
            <th className="px-3 py-2">Persona</th>
            <th className="hidden px-3 py-2 lg:table-cell">Sistema</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {items.map((item) => {
            const type = types.get(item.typeId);
            const active = item.id === selectedId;
            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={clsx('cursor-pointer transition-colors', active ? 'bg-brand-50' : 'hover:bg-ink-50', item.status === 'RETIRED' && 'opacity-60')}
              >
                <td className="px-3 py-2 align-middle">
                  <NetDot state={item.netState} pulse={item.critical} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <TypeIcon type={type} size={14} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" className="truncate text-left font-semibold text-ink-900 hover:underline" onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}>
                          {item.name}
                        </button>
                        {item.number && !item.name.includes(item.number) ? <span className="text-xs tabular-nums text-ink-500">nº {item.number}</span> : null}
                        {item.critical ? <Pill tone="violet">Crític</Pill> : null}
                        {item.needsReview ? <Pill tone="amber" title={item.reviewNote ?? undefined}>A revisar</Pill> : null}
                        {item.ownership === 'PERSONAL' ? <Pill>{OWNERSHIP_LABEL.PERSONAL}</Pill> : null}
                        {item.status !== 'ACTIVE' ? <Pill>{STATUS_LABEL[item.status]}</Pill> : null}
                      </div>
                      <div className="truncate text-xs text-ink-500">
                        {type?.name}
                        <span className="md:hidden">
                          {' · '}
                          {primaryAddress(item)}
                          {assigneeName(item) ? ` · ${assigneeName(item)}` : ''}
                        </span>
                        {item.location ? <span className="xl:hidden"> · {item.location}</span> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-700 md:table-cell">
                  {primaryAddress(item)}
                  {item.addresses.length > 1 ? <span className="ml-1 font-sans text-ink-400">+{item.addresses.length - 1}</span> : null}
                </td>
                <td className="hidden max-w-[14rem] truncate px-3 py-2 text-ink-700 xl:table-cell">{item.location ?? '—'}</td>
                <td className="hidden px-3 py-2 text-ink-700 md:table-cell">{assigneeName(item) ?? <span className="text-ink-400">—</span>}</td>
                <td className="hidden px-3 py-2 text-ink-600 lg:table-cell">{item.os ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: 'brand' | 'amber' | 'emerald' | 'danger';
  onClick?: () => void;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-700',
    danger: 'bg-red-50 text-danger',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-ink-300 hover:shadow"
    >
      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tones[tone])}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold leading-tight tabular-nums text-ink-900">{value}</span>
        <span className="block truncate text-xs text-ink-500">{label}</span>
      </span>
    </button>
  );
}
