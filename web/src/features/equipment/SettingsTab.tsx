import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type DhcpRange, type EquipmentState, type EquipmentType, type Webhook } from '@/api/equipment';
import { ErrorNote, Field, GhostButton, Modal, PrimaryButton, TYPE_ICONS, TypeIcon, inputClass } from './equipmentUi';

interface RangeRow {
  name: string;
  range: string;
}

/** Configuració: rangs d'IP gestionats, rangs DHCP, avisos (webhooks), moneda i tipus d'equip. */
export function SettingsTab({ state, onChanged }: { state: EquipmentState; onChanged: () => void }) {
  const settings = state.settings;
  const [managed, setManaged] = useState<RangeRow[]>(
    settings.managedRanges.map((range) => ({ name: range.name === range.cidr ? '' : range.name, range: range.cidr ?? `${range.from}-${range.to}` })),
  );
  const [ranges, setRanges] = useState<DhcpRange[]>(settings.dhcpRanges);
  const [webhooks, setWebhooks] = useState<Webhook[]>(settings.webhooks);
  const [licenseWarnDays, setLicenseWarnDays] = useState(settings.licenseWarnDays);
  const [certWarnDays, setCertWarnDays] = useState(settings.certWarnDays);
  const [currency, setCurrency] = useState(settings.currency);
  const [suggestions, setSuggestions] = useState<{ name: string; cidr: string; address: string }[]>([]);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<EquipmentType | 'new' | null>(null);

  useEffect(() => {
    equipmentApi.networks().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await equipmentApi.updateSettings({
        managedRanges: managed.filter((row) => row.range.trim()).map((row) => ({ name: row.name.trim() || null, range: row.range.trim() })),
        dhcpRanges: ranges.filter((range) => range.from.trim() && range.to.trim()),
        webhooks: webhooks.filter((hook) => hook.url.trim()),
        licenseWarnDays,
        certWarnDays,
        currency: currency.trim().toUpperCase() || 'EUR',
      });
      setSaved(true);
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function test(index: number) {
    setTesting(index);
    try {
      const result = await equipmentApi.testWebhook(webhooks[index]);
      setTestResult((current) => ({ ...current, [index]: result.ok ? 'Enviat' : result.error ?? 'Error' }));
    } catch (reason) {
      setTestResult((current) => ({ ...current, [index]: readError(reason) }));
    } finally {
      setTesting(null);
    }
  }

  const unused = suggestions.filter((item) => !managed.some((row) => row.range.trim() === item.cidr));

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-ink-200 bg-white p-4 shadow-sm lg:col-span-2">
        <div>
          <h2 className="font-semibold text-ink-900">Xarxes que gestiones</h2>
          <p className="text-sm text-ink-500">
            La pestanya IPs les mostra i el rastreig i la identificació només poden entrar en aquests rangs. Escriu-los com a CIDR (
            <span className="font-mono">192.168.1.0/24</span>) o interval (<span className="font-mono">10.0.0.1-10.0.0.254</span>,{' '}
            <span className="font-mono">10.0.0.1-254</span>). Com a molt 4096 adreces per rang (una /20).
          </p>
        </div>
        <div className="space-y-2">
          {managed.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                value={row.name}
                onChange={(event) => setManaged((rows) => rows.map((item, current) => (current === index ? { ...item, name: event.target.value } : item)))}
                placeholder="Nom (Oficina, Planta, Càmeres…)"
                maxLength={60}
                className={inputClass('sm:w-64')}
                aria-label="Nom del rang"
              />
              <input
                value={row.range}
                onChange={(event) => setManaged((rows) => rows.map((item, current) => (current === index ? { ...item, range: event.target.value } : item)))}
                placeholder="192.168.1.0/24"
                className={inputClass('font-mono')}
                aria-label="Rang"
              />
              <button
                type="button"
                onClick={() => setManaged((rows) => rows.filter((_, current) => current !== index))}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-danger"
                aria-label="Treu el rang"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setManaged((rows) => [...rows, { name: '', range: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              <Plus size={14} /> Afegeix un rang
            </button>
            {unused.map((item) => (
              <button
                key={item.cidr}
                type="button"
                onClick={() => setManaged((rows) => [...rows, { name: '', range: item.cidr }])}
                title={`Xarxa de la interfície ${item.name} del servidor (${item.address})`}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-100"
              >
                <Plus size={12} /> <span className="font-mono">{item.cidr}</span> <span className="font-normal text-brand-600">({item.name})</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-ink-900">Alertes</h2>
        <Field label="Webhooks" hint="(equips crítics caiguts, llicències, IPs…)">
          <div className="space-y-2">
            {webhooks.map((hook, index) => (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <select
                    value={hook.format}
                    onChange={(event) => setWebhooks((rows) => rows.map((row, current) => (current === index ? { ...row, format: event.target.value as Webhook['format'] } : row)))}
                    className={inputClass('w-28 shrink-0 px-2')}
                    aria-label="Format"
                    title="JSON: Slack, Discord, Mattermost, Teams (workflows), Google Chat o el teu servei. ntfy: ntfy.sh o un servidor ntfy."
                  >
                    <option value="json">JSON</option>
                    <option value="ntfy">ntfy</option>
                  </select>
                  <input
                    value={hook.url}
                    onChange={(event) => setWebhooks((rows) => rows.map((row, current) => (current === index ? { ...row, url: event.target.value } : row)))}
                    placeholder={hook.format === 'ntfy' ? 'https://ntfy.sh/el-meu-tema-secret' : 'https://hooks.slack.com/…'}
                    className={inputClass('font-mono text-xs')}
                    aria-label="Adreça"
                  />
                  <button
                    type="button"
                    onClick={() => void test(index)}
                    disabled={!hook.url.trim() || testing !== null}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-brand-700 disabled:opacity-40"
                    aria-label="Envia una prova"
                    title="Envia una prova"
                  >
                    {testing === index ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebhooks((rows) => rows.filter((_, current) => current !== index))}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-danger"
                    aria-label="Treu el webhook"
                  >
                    <X size={16} />
                  </button>
                </div>
                {testResult[index] ? <p className={clsx('text-xs', testResult[index] === 'Enviat' ? 'text-emerald-700' : 'text-danger')}>{testResult[index]}</p> : null}
              </div>
            ))}
            <button type="button" onClick={() => setWebhooks((rows) => [...rows, { url: '', format: 'json' }])} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              <Plus size={14} /> Afegeix un webhook
            </button>
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Llicències" hint="(dies)">
            <input type="number" min={1} max={365} value={licenseWarnDays} onChange={(event) => setLicenseWarnDays(Number(event.target.value) || 1)} className={inputClass()} />
          </Field>
          <Field label="Certificats" hint="(dies)">
            <input type="number" min={1} max={365} value={certWarnDays} onChange={(event) => setCertWarnDays(Number(event.target.value) || 1)} className={inputClass()} />
          </Field>
          <Field label="Moneda">
            <input value={currency} onChange={(event) => setCurrency(event.target.value.slice(0, 3))} placeholder="EUR" className={inputClass('uppercase')} />
          </Field>
        </div>

        <Field label="Rangs dinàmics (DHCP) del router" hint="(avisa si s’hi apunta una IP fixa)">
          <div className="space-y-2">
            {ranges.map((range, index) => (
              <div key={index} className="flex items-center gap-2">
                <input value={range.from} onChange={(event) => setRanges((rows) => rows.map((row, current) => (current === index ? { ...row, from: event.target.value } : row)))} placeholder="192.168.1.100" className={inputClass('font-mono')} aria-label="Des de" />
                <span className="text-ink-400">–</span>
                <input value={range.to} onChange={(event) => setRanges((rows) => rows.map((row, current) => (current === index ? { ...row, to: event.target.value } : row)))} placeholder="192.168.1.199" className={inputClass('font-mono')} aria-label="Fins a" />
                <button type="button" onClick={() => setRanges((rows) => rows.filter((_, current) => current !== index))} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-danger" aria-label="Treu el rang">
                  <X size={16} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setRanges((rows) => [...rows, { from: '', to: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              <Plus size={14} /> Afegeix un rang
            </button>
          </div>
        </Field>
      </section>

      <section className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">Tipus d’equip</h2>
          <button type="button" onClick={() => setEditingType('new')} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            <Plus size={14} /> Nou tipus
          </button>
        </div>
        <ul className="divide-y divide-ink-100">
          {state.types.map((type) => {
            const count = state.equipment.filter((item) => item.typeId === type.id).length;
            return (
              <li key={type.id} className="flex items-center gap-3 py-2">
                <TypeIcon type={type} size={14} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{type.name}</span>
                <span className="text-xs tabular-nums text-ink-500">{count} equips</span>
                <button type="button" onClick={() => setEditingType(type)} className="text-ink-400 hover:text-ink-800" aria-label={`Edita ${type.name}`}>
                  <Pencil size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-xl border border-ink-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:col-span-2">
        <div className="mr-auto min-w-0 flex-1">
          <ErrorNote message={error} />
        </div>
        {saved ? <span className="text-sm text-emerald-700">Desat</span> : null}
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Desa la configuració
        </PrimaryButton>
      </div>

      {editingType ? (
        <TypeDialog
          type={editingType === 'new' ? undefined : editingType}
          nextPosition={Math.max(0, ...state.types.map((type) => type.position)) + 1}
          inUse={editingType !== 'new' && state.equipment.some((item) => item.typeId === editingType.id)}
          onClose={() => setEditingType(null)}
          onSaved={() => {
            setEditingType(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

const COLORS = ['#2442b5', '#1f7f9c', '#7147b6', '#bf6728', '#b42318', '#117963', '#0f766e', '#475569', '#a16207', '#be185d'];

function TypeDialog({ type, nextPosition, inUse, onClose, onSaved }: { type?: EquipmentType; nextPosition: number; inUse: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(type?.name ?? '');
  const [icon, setIcon] = useState(type?.icon ?? 'box');
  const [color, setColor] = useState(type?.color ?? COLORS[0]);
  const [position, setPosition] = useState(type?.position ?? nextPosition);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const body = { name: name.trim(), icon, color, position };
    try {
      if (type) await equipmentApi.updateType(type.id, body);
      else await equipmentApi.createType(body);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  async function remove() {
    if (!type || !window.confirm(`Esborrar el tipus «${type.name}»?`)) return;
    setSaving(true);
    try {
      await equipmentApi.deleteType(type.id);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={type ? 'Edita el tipus' : 'Nou tipus'}
      icon={<TypeIcon type={{ icon, color }} size={14} />}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {type ? (
            <button
              type="button"
              onClick={remove}
              disabled={saving || inUse}
              title={inUse ? 'Hi ha equips d’aquest tipus' : undefined}
              className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-danger hover:underline disabled:opacity-40 disabled:no-underline"
            >
              <Trash2 size={15} /> Esborra
            </button>
          ) : null}
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel·la
          </GhostButton>
          <PrimaryButton onClick={save} disabled={!name.trim() || saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Desa
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="Nom">
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus className={inputClass()} />
          </Field>
          <Field label="Ordre">
            <input type="number" min={0} max={1000} value={position} onChange={(event) => setPosition(Number(event.target.value) || 0)} className={inputClass()} />
          </Field>
        </div>
        <Field label="Icona">
          <div className="grid grid-cols-10 gap-1">
            {Object.entries(TYPE_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-pressed={icon === key}
                title={key}
                className={clsx('grid h-9 place-items-center rounded-md', icon === key ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(value)}
                aria-pressed={color === value}
                aria-label={value}
                className={clsx('h-8 w-8 rounded-full ring-offset-2', color === value && 'ring-2 ring-ink-900')}
                style={{ background: value }}
              />
            ))}
          </div>
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
