import { useMemo, useState } from 'react';
import { Check, Loader2, MonitorCog, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import {
  equipmentApi,
  type AddressMode,
  type Equipment,
  type EquipmentInput,
  type EquipmentDraft,
  type EquipmentState,
  type EquipmentStatus,
  type Ownership,
} from '@/api/equipment';
import {
  ErrorNote,
  Field,
  GhostButton,
  LICENSE_KIND_LABEL,
  Modal,
  OWNERSHIP_LABEL,
  PrimaryButton,
  STATUS_LABEL,
  TypeIcon,
  fold,
  inputClass,
  licenseLabel,
} from './equipmentUi';

interface AddressRow {
  ip: string;
  mode: AddressMode;
  label: string;
  mac: string;
}

interface SoftwareRow {
  name: string;
  version: string;
  notes: string;
}

/** Alta o edició d'un equip: dades, adreces, llicències i programes. */
export function EquipmentDialog({
  item,
  draft,
  state,
  onClose,
  onSaved,
  onDeleted,
}: {
  item?: Equipment;
  /** Nou equip ja omplert (des de la pestanya IPs). */
  draft?: EquipmentDraft;
  state: EquipmentState;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [number, setNumber] = useState(item?.number ?? '');
  const [name, setName] = useState(item?.name ?? draft?.name ?? '');
  const [typeId, setTypeId] = useState(item?.typeId ?? draft?.typeId ?? state.types[0]?.id ?? '');
  const [brand, setBrand] = useState(item?.brand ?? '');
  const [model, setModel] = useState(item?.model ?? draft?.model ?? '');
  const [serial, setSerial] = useState(item?.serial ?? '');
  const [acquired, setAcquired] = useState(item?.acquired ?? '');
  const [price, setPrice] = useState(item?.price !== null && item?.price !== undefined ? String(item.price).replace('.', ',') : '');
  const [location, setLocation] = useState(item?.location ?? draft?.location ?? '');
  const [os, setOs] = useState(item?.os ?? draft?.os ?? '');
  const [assignedName, setAssignedName] = useState(item?.assignedName ?? '');
  const [ownership, setOwnership] = useState<Ownership>(item?.ownership ?? 'COMPANY');
  const [status, setStatus] = useState<EquipmentStatus>(item?.status ?? 'ACTIVE');
  const [critical, setCritical] = useState(item?.critical ?? false);
  const [notes, setNotes] = useState(item?.notes ?? draft?.notes ?? '');
  const [needsReview, setNeedsReview] = useState(item?.needsReview ?? !!draft?.reviewNote);
  const [reviewNote, setReviewNote] = useState(item?.reviewNote ?? draft?.reviewNote ?? '');
  const [addresses, setAddresses] = useState<AddressRow[]>(
    item?.addresses.map((address) => ({ ip: address.ip ?? '', mode: address.mode, label: address.label ?? '', mac: address.mac ?? '' })) ?? [
      { ip: draft?.ip ?? '', mode: 'STATIC', label: '', mac: draft?.mac ?? '' },
    ],
  );
  const [software, setSoftware] = useState<SoftwareRow[]>(
    item?.software.map((row) => ({ name: row.name, version: row.version ?? '', notes: row.notes ?? '' })) ?? [],
  );
  const [licenseIds, setLicenseIds] = useState<string[]>(item?.licenseIds ?? []);
  const [addPing, setAddPing] = useState(true);
  const [licenseQuery, setLicenseQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avís si la IP ja la té un altre equip.
  const clashes = useMemo(() => {
    const out = new Map<string, string>();
    for (const other of state.equipment) {
      if (other.id === item?.id || other.status === 'RETIRED') continue;
      for (const address of other.addresses) if (address.mode === 'STATIC' && address.ip) out.set(address.ip, other.name);
    }
    return out;
  }, [state.equipment, item?.id]);

  const numberClash = number.trim() ? state.equipment.find((other) => other.id !== item?.id && other.number === number.trim()) : undefined;
  const ready = name.trim().length > 0 && !!typeId;
  const licenseOptions = state.licenses.filter((license) => !licenseQuery.trim() || fold(licenseLabel(license)).includes(fold(licenseQuery.trim())));

  async function save() {
    setSaving(true);
    setError(null);
    const parsedPrice = price.trim() ? Number(price.replace(/\./g, '').replace(',', '.')) : null;
    if (parsedPrice !== null && !Number.isFinite(parsedPrice)) {
      setError('El preu no és un número');
      setSaving(false);
      return;
    }
    const body: EquipmentInput = {
      number: number.trim() || null,
      name: name.trim(),
      typeId,
      brand: brand.trim() || null,
      model: model.trim() || null,
      serial: serial.trim() || null,
      acquired: acquired.trim() || null,
      price: parsedPrice,
      location: location.trim() || null,
      os: os.trim() || null,
      assignedName: assignedName.trim() || null,
      ownership,
      status,
      critical,
      notes: notes.trim() || null,
      needsReview,
      reviewNote: needsReview ? reviewNote.trim() || null : null,
      addresses: addresses
        .filter((address) => address.ip.trim() || address.mode === 'DHCP')
        .map((address) => ({ ip: address.ip.trim() || null, mode: address.mode, label: address.label.trim() || null, mac: address.mac.trim() || null })),
      software: software.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), version: row.version.trim() || null, notes: row.notes.trim() || null })),
      licenseIds,
      ...(item ? {} : { addPing }),
    };
    try {
      if (item) {
        await equipmentApi.updateItem(item.id, body);
        onSaved(item.id);
      } else {
        const created = await equipmentApi.createItem(body);
        onSaved(created.id);
      }
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Esborrar «${item.name}» amb les seves proves, credencials i historial? No es pot desfer (si només ja no s’usa, posa’l «De baixa»).`)) return;
    setSaving(true);
    try {
      await equipmentApi.deleteItem(item.id);
      onDeleted();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  const updateAddress = (index: number, patch: Partial<AddressRow>) =>
    setAddresses((rows) => rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  const updateSoftware = (index: number, patch: Partial<SoftwareRow>) =>
    setSoftware((rows) => rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));

  return (
    <Modal
      wide
      title={item ? `Edita ${item.name}` : 'Nou equip'}
      subtitle="Ordinador, impressora, servidor, màquina de taller…"
      icon={<MonitorCog size={18} />}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {item ? (
            <button type="button" onClick={remove} disabled={saving} className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-danger hover:underline">
              <Trash2 size={15} /> Esborra l’equip
            </button>
          ) : null}
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel·la
          </GhostButton>
          <PrimaryButton onClick={save} disabled={!ready || saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {item ? 'Desa els canvis' : 'Crea l’equip'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-6">
        <Field label="Tipus">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipus d’equip">
            {state.types.map((type) => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={typeId === type.id}
                onClick={() => setTypeId(type.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full border-2 py-0.5 pl-0.5 pr-3 text-sm font-medium transition-colors',
                  typeId === type.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:border-ink-300',
                )}
              >
                <TypeIcon type={type} size={12} />
                {type.name}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="Número">
            <input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="01" maxLength={20} className={inputClass('tabular-nums')} />
          </Field>
          <Field label="Nom">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="PC01, Impressora planta 1, Torn CNC…" maxLength={120} autoFocus className={inputClass('font-semibold')} />
          </Field>
        </div>
        {numberClash ? <p className="-mt-4 text-xs text-amber-700">El número {number.trim()} ja el té «{numberClash.name}».</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ubicació">
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Oficina, planta 1" maxLength={160} className={inputClass()} />
          </Field>
          <Field label="Persona">
            <input value={assignedName} onChange={(event) => setAssignedName(event.target.value)} placeholder="Qui el fa servir («Anna», «Compartit»…)" maxLength={120} className={inputClass()} />
          </Field>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">Adreces de xarxa</p>
            <button
              type="button"
              onClick={() => setAddresses((rows) => [...rows, { ip: '', mode: 'STATIC', label: '', mac: '' }])}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
            >
              <Plus size={14} /> Afegeix
            </button>
          </div>
          {addresses.length === 0 ? <p className="text-sm text-ink-500">Sense xarxa.</p> : null}
          {addresses.map((address, index) => {
            const clash = address.mode === 'STATIC' && clashes.get(address.ip.trim().replace(/\b0+(\d)/g, '$1'));
            return (
              <div key={index} className="rounded-xl bg-ink-50 p-2">
                <div className="grid gap-2 sm:grid-cols-[7rem_1fr_1fr_1fr_auto]">
                  <select value={address.mode} onChange={(event) => updateAddress(index, { mode: event.target.value as AddressMode })} className={inputClass()} aria-label="Tipus d’adreça">
                    <option value="STATIC">Fixa</option>
                    <option value="DHCP">DHCP</option>
                  </select>
                  <input
                    value={address.ip}
                    onChange={(event) => updateAddress(index, { ip: event.target.value })}
                    placeholder={address.mode === 'DHCP' ? 'IP (opcional)' : '192.168.1.50'}
                    className={inputClass('font-mono')}
                    aria-label="IP"
                  />
                  <input value={address.label} onChange={(event) => updateAddress(index, { label: event.target.value })} placeholder="Etiqueta (Disc 1…)" maxLength={60} className={inputClass()} aria-label="Etiqueta" />
                  <input value={address.mac} onChange={(event) => updateAddress(index, { mac: event.target.value })} placeholder="MAC (opcional)" maxLength={30} className={inputClass('font-mono')} aria-label="MAC" />
                  <button type="button" onClick={() => setAddresses((rows) => rows.filter((_, current) => current !== index))} className="grid h-10 w-10 place-items-center rounded-lg text-ink-400 hover:bg-white hover:text-danger" aria-label="Treu l’adreça">
                    <X size={16} />
                  </button>
                </div>
                {clash ? <p className="mt-1 text-xs text-amber-700">Aquesta IP ja la té «{clash}».</p> : null}
              </div>
            );
          })}
          {!item ? (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={addPing} onChange={(event) => setAddPing(event.target.checked)} className="h-4 w-4 rounded border-ink-300" />
              Afegeix una prova de ping cada 5 minuts a la primera IP fixa
            </label>
          ) : null}
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sistema">
            <input value={os} onChange={(event) => setOs(event.target.value)} placeholder="Windows 11" maxLength={80} className={inputClass()} />
          </Field>
          <Field label="Marca">
            <input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} className={inputClass()} />
          </Field>
          <Field label="Model">
            <input value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} className={inputClass()} />
          </Field>
          <Field label="Núm. de sèrie">
            <input value={serial} onChange={(event) => setSerial(event.target.value)} maxLength={120} className={inputClass('font-mono')} />
          </Field>
          <Field label="Adquirit" hint="(any-mes)">
            <input value={acquired} onChange={(event) => setAcquired(event.target.value)} placeholder="2024-09" maxLength={10} className={inputClass()} />
          </Field>
          <Field label="Preu (€)">
            <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="380,00" className={inputClass('tabular-nums')} />
          </Field>
        </div>

        <section className="space-y-2">
          <p className="text-sm font-medium text-ink-800">Llicències</p>
          {state.licenses.length === 0 ? (
            <p className="text-sm text-ink-500">Encara no hi ha llicències al catàleg (pestanya Llicències).</p>
          ) : (
            <>
              {state.licenses.length > 8 ? (
                <input value={licenseQuery} onChange={(event) => setLicenseQuery(event.target.value)} placeholder="Filtra llicències…" className={inputClass('h-9')} />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {licenseOptions.map((license) => {
                  const active = licenseIds.includes(license.id);
                  return (
                    <button
                      key={license.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setLicenseIds((ids) => (active ? ids.filter((id) => id !== license.id) : [...ids, license.id]))}
                      className={clsx(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        active ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
                      )}
                      title={LICENSE_KIND_LABEL[license.kind]}
                    >
                      {licenseLabel(license)}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">
              Altres programes <span className="font-normal text-ink-500">(sense llicència al catàleg)</span>
            </p>
            <button type="button" onClick={() => setSoftware((rows) => [...rows, { name: '', version: '', notes: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              <Plus size={14} /> Afegeix
            </button>
          </div>
          {software.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]">
              <input value={row.name} onChange={(event) => updateSoftware(index, { name: event.target.value })} placeholder="DWG TrueView" maxLength={120} className={inputClass()} aria-label="Programa" />
              <input value={row.version} onChange={(event) => updateSoftware(index, { version: event.target.value })} placeholder="Versió" maxLength={60} className={inputClass()} aria-label="Versió" />
              <input value={row.notes} onChange={(event) => updateSoftware(index, { notes: event.target.value })} placeholder="Notes" maxLength={300} className={inputClass()} aria-label="Notes" />
              <button type="button" onClick={() => setSoftware((rows) => rows.filter((_, current) => current !== index))} className="grid h-10 w-10 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-danger" aria-label="Treu el programa">
                <X size={16} />
              </button>
            </div>
          ))}
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Propietat">
            <Segmented value={ownership} onChange={setOwnership} options={OWNERSHIP_LABEL} />
          </Field>
          <Field label="Estat">
            <Segmented value={status} onChange={setStatus} options={STATUS_LABEL} />
          </Field>
        </div>

        <label className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-sm text-ink-800">
          <input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
          <span>
            <strong>Equip crític.</strong> Si deixa de respondre, s’avisa pels webhooks de Configuració (i quan torna).
          </span>
        </label>

        <Field label="Observacions">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={4000} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </Field>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={needsReview} onChange={(event) => setNeedsReview(event.target.checked)} className="h-4 w-4 rounded border-ink-300" />
            A revisar (hi ha alguna dada dubtosa)
          </label>
          {needsReview ? <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Què s’ha de revisar" maxLength={500} className={inputClass()} /> : null}
        </div>

        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: Record<T, string> }) {
  return (
    <div className="inline-flex rounded-lg bg-ink-100 p-1">
      {(Object.keys(options) as T[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={clsx('h-8 rounded-md px-3 text-sm font-medium', value === key ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-600 hover:text-ink-900')}
        >
          {options[key]}
        </button>
      ))}
    </div>
  );
}
