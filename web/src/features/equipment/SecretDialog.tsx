import { useState } from 'react';
import { Check, Loader2, Lock, Trash2 } from 'lucide-react';

import { readError } from '@/api/client';
import { equipmentApi, type EquipmentSecretInfo } from '@/api/equipment';
import { ErrorNote, Field, GhostButton, Modal, PrimaryButton, inputClass } from './equipmentUi';

/** Credencial d'un equip. La contrasenya es desa xifrada i no es torna a mostrar aquí. */
export function SecretDialog({
  equipmentId,
  secret,
  onClose,
  onSaved,
}: {
  equipmentId: string;
  secret?: EquipmentSecretInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(secret?.label ?? '');
  const [username, setUsername] = useState(secret?.username ?? '');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState(secret?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = label.trim().length > 0 && (!!secret || value.length > 0);

  async function save() {
    setSaving(true);
    setError(null);
    const body = { label: label.trim(), username: username.trim() || null, notes: notes.trim() || null, ...(value ? { value } : {}) };
    try {
      if (secret) await equipmentApi.updateSecret(secret.id, body);
      else await equipmentApi.createSecret(equipmentId, body);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  async function remove() {
    if (!secret || !window.confirm(`Esborrar la credencial «${secret.label}»?`)) return;
    setSaving(true);
    try {
      await equipmentApi.deleteSecret(secret.id);
      onSaved();
    } catch (reason) {
      setError(readError(reason));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={secret ? 'Edita la credencial' : 'Nova credencial'}
      subtitle="Es desa xifrada al servidor (AES-256-GCM)."
      icon={<Lock size={18} />}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          {secret ? (
            <button type="button" onClick={remove} disabled={saving} className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-danger hover:underline">
              <Trash2 size={15} /> Esborra
            </button>
          ) : null}
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel·la
          </GhostButton>
          <PrimaryButton onClick={save} disabled={!ready || saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Desa
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Què és">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Admin local, web de la impressora…" maxLength={80} autoFocus className={inputClass()} />
        </Field>
        <Field label="Usuari" hint="(opcional)">
          <input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={120} autoComplete="off" className={inputClass('font-mono')} />
        </Field>
        <Field label="Contrasenya" hint={secret ? '(buida = no es canvia)' : undefined}>
          <input type="password" value={value} onChange={(event) => setValue(event.target.value)} maxLength={500} autoComplete="new-password" className={inputClass('font-mono')} />
        </Field>
        <Field label="Notes" hint="(opcional)">
          <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} className={inputClass()} />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
