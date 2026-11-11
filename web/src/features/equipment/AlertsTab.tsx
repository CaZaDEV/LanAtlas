import { useState } from 'react';
import { BellOff, Check, CheckCheck, KeyRound, Loader2, ShieldAlert, WifiOff } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type EquipmentAlert, type EquipmentState } from '@/api/equipment';
import { ALERT_KIND_LABEL, formatDateTime, since } from './equipmentUi';

/** Alertes obertes (primer les no vistes) i les tancades dels últims 30 dies. */
export function AlertsTab({
  state,
  onChanged,
  onOpenEquipment,
  onOpenLicenses,
}: {
  state: EquipmentState;
  onChanged: () => void;
  onOpenEquipment: (id: string) => void;
  onOpenLicenses: () => void;
}) {
  const open = state.alerts
    .filter((alert) => !alert.closedAt)
    .sort((a, b) => Number(!!a.ackedAt) - Number(!!b.ackedAt) || b.openedAt.localeCompare(a.openedAt));
  const closed = state.alerts.filter((alert) => alert.closedAt);
  const recipients = state.settings.webhooks.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {state.access.manager && recipients === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          Les alertes només es veuen aquí. Per rebre-les al mòbil o al xat (ntfy, Slack, Discord, Teams…), afegeix un webhook a Configuració.
        </p>
      ) : null}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-800">Obertes ({open.length})</h2>
        {open.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-white p-6 text-sm text-ink-500">
            <BellOff size={16} /> Cap alerta oberta. Tot en ordre.
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onChanged={onChanged} onOpen={() => openTarget(alert)} />
            ))}
          </ul>
        )}
      </section>
      {closed.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-800">Resoltes els últims 30 dies</h2>
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white">
            {closed.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">{ALERT_KIND_LABEL[alert.kind]}</span>
                <button type="button" onClick={() => openTarget(alert)} className="min-w-0 flex-1 text-left text-ink-700 hover:underline">
                  {alert.message}
                </button>
                <span className="text-xs text-ink-400">
                  {formatDateTime(alert.openedAt)} → {formatDateTime(alert.closedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  function openTarget(alert: EquipmentAlert) {
    if (alert.equipmentId) onOpenEquipment(alert.equipmentId);
    else if (alert.licenseId) onOpenLicenses();
  }
}

function AlertRow({ alert, onChanged, onOpen }: { alert: EquipmentAlert; onChanged: () => void; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = alert.kind === 'DOWN' ? WifiOff : alert.kind.startsWith('LICENSE') ? KeyRound : ShieldAlert;
  const severe = alert.kind === 'DOWN' || alert.kind === 'LICENSE_EXPIRED';

  async function ack() {
    setBusy(true);
    setError(null);
    try {
      await equipmentApi.ackAlert(alert.id);
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={clsx(
        'flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm',
        alert.ackedAt ? 'border-ink-200 opacity-80' : severe ? 'border-red-300' : 'border-amber-300',
      )}
    >
      <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', severe ? 'bg-red-50 text-danger' : 'bg-amber-50 text-amber-700')}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{ALERT_KIND_LABEL[alert.kind]}</p>
        <button type="button" onClick={onOpen} className="text-left text-sm font-medium text-ink-900 hover:underline">
          {alert.message}
        </button>
        <p className="text-xs text-ink-500">
          Des de {formatDateTime(alert.openedAt)} ({since(alert.openedAt)})
          {alert.ackedAt ? ` · vista per ${alert.ackedByName ?? '?'}` : ''}
        </p>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
      {alert.ackedAt ? (
        <CheckCheck size={18} className="mt-2 text-emerald-600" aria-label="Vista" />
      ) : (
        <button type="button" onClick={ack} disabled={busy} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 text-xs font-semibold text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Vista
        </button>
      )}
    </li>
  );
}
