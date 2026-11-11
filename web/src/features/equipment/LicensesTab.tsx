import { useMemo, useState } from 'react';
import { Check, KeyRound, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type EquipmentLicense, type EquipmentState, type LicenseKind } from '@/api/equipment';
import {
  ErrorNote,
  Field,
  GhostButton,
  LICENSE_KIND_LABEL,
  Modal,
  Pill,
  PrimaryButton,
  SecretValue,
  daysTo,
  fold,
  formatDate,
  inputClass,
  licenseLabel,
  money,
} from './equipmentUi';

/** Catàleg de llicències: places, caducitat, clau i equips on és. */
export function LicensesTab({
  state,
  onChanged,
  onOpenEquipment,
}: {
  state: EquipmentState;
  onChanged: () => void;
  onOpenEquipment: (id: string) => void;
}) {
  const manager = state.access.manager;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EquipmentLicense | 'new' | null>(null);
  const names = useMemo(() => new Map(state.equipment.map((item) => [item.id, item.name])), [state.equipment]);
  const warn = state.settings?.licenseWarnDays ?? 30;

  const list = state.licenses.filter((license) => {
    if (!query.trim()) return true;
    const text = fold([licenseLabel(license), license.vendor, license.notes, license.keyHint, ...license.equipmentIds.map((id) => names.get(id))].filter(Boolean).join(' '));
    return fold(query).split(/\s+/).filter(Boolean).every((word) => text.includes(word));
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca programa, proveïdor o equip…" className={inputClass('pl-9')} />
        </label>
        {manager ? (
          <button type="button" onClick={() => setEditing('new')} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
            <Plus size={16} /> Nova llicència
          </button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">Cap llicència.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((license) => {
            const days = daysTo(license.expiresAt);
            const used = license.equipmentIds.length;
            const over = license.kind !== 'FLOATING' && license.seats !== null && used > license.seats;
            return (
              <article key={license.id} className={clsx('flex flex-col rounded-xl border bg-white p-4 shadow-sm', days !== null && days < 0 ? 'border-red-300' : 'border-ink-200')}>
                <header className="flex items-start gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <KeyRound size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-ink-900">{licenseLabel(license)}</h3>
                    <div className="flex flex-wrap gap-1">
                      <Pill>{LICENSE_KIND_LABEL[license.kind]}</Pill>
                      {days !== null ? (
                        <Pill tone={days < 0 ? 'red' : days <= warn ? 'amber' : 'emerald'}>
                          {days < 0 ? `Caducada fa ${-days} dies` : days === 0 ? 'Caduca avui' : `Caduca el ${formatDate(license.expiresAt)}`}
                        </Pill>
                      ) : null}
                    </div>
                  </div>
                  {manager ? (
                    <button type="button" onClick={() => setEditing(license)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-900" aria-label={`Edita ${licenseLabel(license)}`}>
                      <Pencil size={15} />
                    </button>
                  ) : null}
                </header>
                <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
                  <dt className="text-ink-500">Equips</dt>
                  <dd className={clsx('font-medium', over ? 'text-danger' : 'text-ink-900')}>
                    {used}
                    {license.seats !== null ? ` de ${license.seats} ${license.kind === 'FLOATING' ? 'simultànies' : 'places'}` : ''}
                  </dd>
                  {license.vendor ? (
                    <>
                      <dt className="text-ink-500">Proveïdor</dt>
                      <dd className="text-ink-900">{license.vendor}</dd>
                    </>
                  ) : null}
                  {manager && license.cost !== null ? (
                    <>
                      <dt className="text-ink-500">Cost</dt>
                      <dd className="text-ink-900">{money(license.cost)}</dd>
                    </>
                  ) : null}
                  {license.hasKey || license.keyHint ? (
                    <>
                      <dt className="text-ink-500">Clau</dt>
                      <dd>
                        {manager && license.hasKey ? (
                          <SecretValue reveal={() => equipmentApi.revealLicense(license.id)} hint={license.keyHint} />
                        ) : (
                          <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">•••• {license.keyHint ?? ''}</code>
                        )}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {license.notes ? <p className="mt-2 whitespace-pre-wrap text-xs text-ink-600">{license.notes}</p> : null}
                {used ? (
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-ink-100 pt-3">
                    {license.equipmentIds
                      .map((id) => ({ id, name: names.get(id) ?? '?' }))
                      .sort((a, b) => a.name.localeCompare(b.name, 'ca', { numeric: true }))
                      .map((row) => (
                        <button key={row.id} type="button" onClick={() => onOpenEquipment(row.id)} className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-700 hover:bg-brand-50 hover:text-brand-700">
                          {row.name}
                        </button>
                      ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {editing ? (
        <LicenseDialog
          license={editing === 'new' ? undefined : editing}
          state={state}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function LicenseDialog({ license, state, onClose, onSaved }: { license?: EquipmentLicense; state: EquipmentState; onClose: () => void; onSaved: () => void }) {
  const [product, setProduct] = useState(license?.product ?? '');
  const [version, setVersion] = useState(license?.version ?? '');
  const [kind, setKind] = useState<LicenseKind>(license?.kind ?? 'SUBSCRIPTION');
  const [seats, setSeats] = useState(license?.seats !== null && license?.seats !== undefined ? String(license.seats) : '');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [keyHint, setKeyHint] = useState(license?.keyHint ?? '');
  const [vendor, setVendor] = useState(license?.vendor ?? '');
  const [purchasedAt, setPurchasedAt] = useState(license?.purchasedAt?.slice(0, 10) ?? '');
  const [expiresAt, setExpiresAt] = useState(license?.expiresAt?.slice(0, 10) ?? '');
  const [cost, setCost] = useState(license?.cost !== null && license?.cost !== undefined ? String(license.cost).replace('.', ',') : '');
  const [notes, setNotes] = useState(license?.notes ?? '');
  const [equipmentIds, setEquipmentIds] = useState<string[]>(license?.equipmentIds ?? []);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = state.equipment
    .filter((item) => item.status !== 'RETIRED' || equipmentIds.includes(item.id))
    .filter((item) => !filter.trim() || fold(`${item.name} ${item.number ?? ''} ${item.assignedName ?? ''} ${item.location ?? ''}`).includes(fold(filter.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'ca', { numeric: true }));

  async function save() {
    setSaving(true);
    setError(null);
    const parsedCost = cost.trim() ? Number(cost.replace(/\./g, '').replace(',', '.')) : null;
    const body = {
      product: product.trim(),
      version: version.trim() || null,
      kind,
      seats: seats.trim() ? Number(seats) : null,
      ...(key.trim() ? { key: key.trim() } : clearKey ? { key: null } : {}),
      keyHint: keyHint.trim() || null,
      vendor: vendor.trim() || null,
      purchasedAt: purchasedAt || null,
      expiresAt: expiresAt || null,
      cost: parsedCost !== null && Number.isFinite(parsedCost) ? parsedCost : null,
      notes: notes.trim() || null,
      equipmentIds,
    };
    try {
      if (license) await equipmentApi.updateLicense(license.id, body);
      else await equipmentApi.createLicense(body);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  async function remove() {
    if (!license || !window.confirm(`Esborrar la llicència «${licenseLabel(license)}»? Es treu de tots els equips.`)) return;
    setSaving(true);
    try {
      await equipmentApi.deleteLicense(license.id);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  return (
    <Modal
      wide
      title={license ? `Edita ${licenseLabel(license)}` : 'Nova llicència'}
      icon={<KeyRound size={18} />}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {license ? (
            <button type="button" onClick={remove} disabled={saving} className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-danger hover:underline">
              <Trash2 size={15} /> Esborra
            </button>
          ) : null}
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel·la
          </GhostButton>
          <PrimaryButton onClick={save} disabled={!product.trim() || saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Desa
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="Programa">
            <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="AutoCAD LT" maxLength={120} autoFocus className={inputClass('font-semibold')} />
          </Field>
          <Field label="Versió / edició">
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2024" maxLength={60} className={inputClass()} />
          </Field>
        </div>
        <Field label="Tipus">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(LICENSE_KIND_LABEL) as LicenseKind[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={clsx('h-8 rounded-md px-3 text-sm font-medium', kind === value ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}
              >
                {LICENSE_KIND_LABEL[value]}
              </button>
            ))}
          </div>
          {kind === 'FLOATING' ? <p className="text-xs text-ink-500">Flotant: les places són simultànies, es pot instal·lar a més equips sense avís.</p> : null}
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Places">
            <input value={seats} onChange={(event) => setSeats(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="—" className={inputClass('tabular-nums')} />
          </Field>
          <Field label="Compra">
            <input type="date" value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Caducitat">
            <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Cost (€)">
            <input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" className={inputClass('tabular-nums')} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_1fr]">
          <Field label="Clau" hint={license?.hasKey ? '(buida = no es canvia)' : undefined}>
            {state.secretsEnabled ? (
              <textarea
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={license?.hasKey ? '•••••••• (desada)' : 'XXXXX-XXXXX-… (una o més línies)'}
                autoComplete="off"
                spellCheck={false}
                rows={key.includes('\n') ? 4 : 1}
                maxLength={1000}
                className="w-full resize-y rounded-lg border border-ink-200 px-3 py-2 font-mono text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            ) : (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">Falta EQUIPMENT_SECRET_KEY al servidor: no es poden desar claus.</p>
            )}
            {license?.hasKey && !key ? (
              <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-600">
                <input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} /> Esborra la clau desada
              </label>
            ) : null}
          </Field>
          <Field label="Pista" hint="(visible)">
            <input value={keyHint} onChange={(event) => setKeyHint(event.target.value)} placeholder="…488" maxLength={20} className={inputClass('font-mono')} />
          </Field>
          <Field label="Proveïdor">
            <input value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={120} className={inputClass()} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </Field>
        <Field label={`Equips on és (${equipmentIds.length})`}>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtra equips…" className={inputClass('h-9 pl-8')} />
            {filter ? (
              <button type="button" onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" aria-label="Esborra el filtre">
                <X size={14} />
              </button>
            ) : null}
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-ink-200 p-2">
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((item) => {
                const active = equipmentIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEquipmentIds((ids) => (active ? ids.filter((id) => id !== item.id) : [...ids, item.id]))}
                    className={clsx(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
                    )}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
