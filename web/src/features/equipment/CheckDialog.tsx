import { useState } from 'react';
import { Activity, Check, Loader2, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type CheckKind, type Equipment, type EquipmentCheck } from '@/api/equipment';
import { CHECK_KIND_LABEL, ErrorNote, Field, GhostButton, Modal, PrimaryButton, inputClass, primaryAddress } from './equipmentUi';

const HINT: Record<CheckKind, string> = {
  PING: 'Respon a la xarxa? Serveix per a gairebé tot.',
  TCP: 'Un servei concret contesta: 9100 impressores, 3389 escriptori remot, 1433 SQL, 445 carpetes…',
  HTTP: 'Una web o panell contesta; amb https també avisa abans que caduqui el certificat.',
};

const INTERVALS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
  { value: 3600, label: '1 hora' },
];

/** Alta o edició d'una prova d'estat (ping, port TCP o web). */
export function CheckDialog({
  equipment,
  check,
  onClose,
  onSaved,
}: {
  equipment: Equipment;
  check?: EquipmentCheck;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<CheckKind>(check?.kind ?? 'PING');
  const [target, setTarget] = useState(check?.target ?? '');
  const [port, setPort] = useState(check?.port ? String(check.port) : '');
  const [url, setUrl] = useState(check?.url ?? '');
  const [intervalSec, setIntervalSec] = useState(check?.intervalSec ?? 300);
  const [failThreshold, setFailThreshold] = useState(check?.failThreshold ?? 3);
  const [enabled, setEnabled] = useState(check?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultHost = primaryAddress(equipment);

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      kind,
      target: target.trim() || null,
      port: kind === 'TCP' ? Number(port) || null : null,
      url: kind === 'HTTP' ? url.trim() || null : null,
      intervalSec,
      failThreshold,
      enabled,
    };
    try {
      if (check) await equipmentApi.updateCheck(check.id, body);
      else await equipmentApi.createCheck(equipment.id, body);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  async function remove() {
    if (!check || !window.confirm('Esborrar aquesta prova i el seu historial?')) return;
    setSaving(true);
    try {
      await equipmentApi.deleteCheck(check.id);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={check ? 'Edita la prova' : 'Nova prova d’estat'}
      subtitle={equipment.name}
      icon={<Activity size={18} />}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {check ? (
            <button type="button" onClick={remove} disabled={saving} className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-danger hover:underline">
              <Trash2 size={15} /> Esborra
            </button>
          ) : null}
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel·la
          </GhostButton>
          <PrimaryButton onClick={save} disabled={saving || (kind === 'TCP' && !Number(port))}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Desa
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Què es prova">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CHECK_KIND_LABEL) as CheckKind[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={clsx(
                  'rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
                  kind === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:border-ink-300',
                )}
              >
                {CHECK_KIND_LABEL[value]}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500">{HINT[kind]}</p>
        </Field>

        {kind === 'HTTP' ? (
          <Field label="Adreça" hint="(buida: http://IP de l’equip/)">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={`https://${defaultHost}/`} className={inputClass('font-mono')} />
          </Field>
        ) : (
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field label="IP o nom" hint={`(buida: ${defaultHost})`}>
              <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={defaultHost} className={inputClass('font-mono')} />
            </Field>
            {kind === 'TCP' ? (
              <Field label="Port">
                <input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="9100" className={inputClass('font-mono')} />
              </Field>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cada quant">
            <div className="flex flex-wrap gap-1">
              {INTERVALS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setIntervalSec(option.value)}
                  aria-pressed={intervalSec === option.value}
                  className={clsx('h-8 rounded-md px-2.5 text-sm font-medium', intervalSec === option.value ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Caigut després de" hint="(fallades seguides)">
            <input
              type="number"
              min={1}
              max={20}
              value={failThreshold}
              onChange={(event) => setFailThreshold(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
              className={inputClass('w-24')}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-ink-300" />
          Activa (es prova sola periòdicament)
        </label>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
