import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, KeyRound, Loader2, Lock, Pencil, Play, Plus, X } from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, type Equipment, type EquipmentCheck, type EquipmentSecretInfo, type EquipmentState } from '@/api/equipment';
import { CheckDialog } from './CheckDialog';
import { SecretDialog } from './SecretDialog';
import {
  LICENSE_KIND_LABEL,
  NetDot,
  OWNERSHIP_LABEL,
  Pill,
  STATUS_LABEL,
  SecretValue,
  SectionTitle,
  TypeIcon,
  assigneeName,
  formatDateTime,
  licenseLabel,
  money,
  since,
} from './equipmentUi';

type Dialog = { kind: 'check'; check?: EquipmentCheck } | { kind: 'secret'; secret?: EquipmentSecretInfo } | null;

/** Fitxa lateral d'un equip: dades, adreces, proves, historial, llicències, programes i credencials. */
export function EquipmentPanel({
  item,
  state,
  onClose,
  onEdit,
  onChanged,
  mapActions,
}: {
  item: Equipment;
  state: EquipmentState;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  /** Botons del mapa («Veure al mapa», «Ubica al mapa»…). */
  mapActions?: ReactNode;
}) {
  const manager = state.access.manager;
  const type = state.types.find((row) => row.id === item.typeId);
  const licenses = item.licenseIds.map((id) => state.licenses.find((license) => license.id === id)).filter(Boolean);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAll() {
    setRunningAll(true);
    setError(null);
    try {
      await equipmentApi.runItem(item.id);
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setRunningAll(false);
    }
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl lg:shadow-sm" aria-label={`Fitxa de ${item.name}`}>
      <header className="flex items-start gap-3 border-b border-ink-100 px-4 py-3">
        <TypeIcon type={type} size={18} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-ink-900">{item.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            <span>{type?.name}</span>
            {item.number ? <span>· nº {item.number}</span> : null}
            <NetDot state={item.netState} withLabel pulse={item.critical} />
            {item.critical ? <Pill tone="violet">Crític</Pill> : null}
          </div>
        </div>
        {manager ? (
          <button type="button" onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Edita l’equip" title="Edita">
            <Pencil size={16} />
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Tanca la fitxa">
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
        {mapActions}
        {item.needsReview ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <strong>A revisar.</strong> {item.reviewNote ?? ''}
          </p>
        ) : null}

        <section>
          <SectionTitle>Dades</SectionTitle>
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Row label="Persona">{assigneeName(item)}</Row>

            <Row label="Ubicació">{item.location}</Row>
            <Row label="Mapa">
              {item.mapX !== null ? (
                `${state.maps.find((map) => map.id === item.mapId)?.name ?? 'Ubicat'}${item.mapCode ? ` · ${item.mapCode}` : ''}`
              ) : (
                <span className="text-ink-400">Sense ubicar</span>
              )}
            </Row>
            <Row label="Sistema">{item.os}</Row>
            <Row label="Marca / model">{[item.brand, item.model].filter(Boolean).join(' ') || null}</Row>
            <Row label="Núm. de sèrie">{item.serial}</Row>
            <Row label="Adquirit">{item.acquired}</Row>
            {manager ? <Row label="Preu">{item.price !== null ? money(item.price) : null}</Row> : null}
            <Row label="Propietat">{OWNERSHIP_LABEL[item.ownership]}</Row>
            <Row label="Estat">{STATUS_LABEL[item.status]}</Row>
          </dl>
          {item.notes ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{item.notes}</p> : null}
        </section>

        <section>
          <SectionTitle>Adreces</SectionTitle>
          {item.addresses.length === 0 ? (
            <p className="text-sm text-ink-500">Sense xarxa apuntada.</p>
          ) : (
            <ul className="space-y-1">
              {item.addresses.map((address, index) => (
                <li key={address.id ?? index} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-900">{address.ip ?? 'IP dinàmica'}</code>
                  <Pill tone={address.mode === 'DHCP' ? 'amber' : 'ink'}>{address.mode === 'DHCP' ? 'DHCP' : 'Fixa'}</Pill>
                  {address.label ? <span className="text-ink-600">{address.label}</span> : null}
                  {address.mac ? <span className="font-mono text-xs text-ink-500">{address.mac}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle
            action={
              <div className="flex items-center gap-1">
                {item.checks.length ? (
                  <button type="button" onClick={runAll} disabled={runningAll} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                    {runningAll ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Prova-ho tot
                  </button>
                ) : null}
                {manager ? (
                  <button type="button" onClick={() => setDialog({ kind: 'check' })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-100">
                    <Plus size={13} /> Prova
                  </button>
                ) : null}
              </div>
            }
          >
            Proves d’estat
          </SectionTitle>
          {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
          {item.checks.length === 0 ? (
            <p className="text-sm text-ink-500">Cap prova. {manager ? 'Afegeix-ne una (ping, port o web) per saber si respon.' : ''}</p>
          ) : (
            <ul className="space-y-2">
              {item.checks.map((check) => (
                <CheckRow key={check.id} check={check} manager={manager} onEdit={() => setDialog({ kind: 'check', check })} onChanged={onChanged} />
              ))}
            </ul>
          )}
          {item.checks.length ? <History equipmentId={item.id} checks={item.checks} /> : null}
        </section>

        <section>
          <SectionTitle>Llicències</SectionTitle>
          {licenses.length === 0 ? (
            <p className="text-sm text-ink-500">Cap llicència assignada.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {licenses.map((license) => (
                <li key={license!.id}>
                  <Pill tone="brand" title={LICENSE_KIND_LABEL[license!.kind]}>
                    <KeyRound size={11} aria-hidden="true" /> {licenseLabel(license!)}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Programes</SectionTitle>
          {item.software.length === 0 ? (
            <p className="text-sm text-ink-500">Cap programa apuntat (a part de les llicències).</p>
          ) : (
            <ul className="space-y-0.5 text-sm text-ink-800">
              {item.software.map((row, index) => (
                <li key={row.id ?? index}>
                  {row.name}
                  {row.version ? <span className="text-ink-500"> · {row.version}</span> : null}
                  {row.notes ? <span className="text-ink-500"> — {row.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {manager ? (
          <section>
            <SectionTitle
              action={
                state.secretsEnabled ? (
                  <button type="button" onClick={() => setDialog({ kind: 'secret' })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-100">
                    <Plus size={13} /> Credencial
                  </button>
                ) : null
              }
            >
              Credencials
            </SectionTitle>
            {!state.secretsEnabled ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                <Lock size={12} className="mr-1 inline" aria-hidden="true" />
                Desactivades: falta la clau <code>EQUIPMENT_SECRET_KEY</code> al servidor (docs/EQUIPS.md).
              </p>
            ) : item.secrets.length === 0 ? (
              <p className="text-sm text-ink-500">Cap credencial desada.</p>
            ) : (
              <ul className="space-y-2">
                {item.secrets.map((secret) => (
                  <li key={secret.id} className="rounded-lg border border-ink-200 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Lock size={14} className="text-ink-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{secret.label}</span>
                      <button type="button" onClick={() => setDialog({ kind: 'secret', secret })} className="text-ink-400 hover:text-ink-800" aria-label={`Edita ${secret.label}`}>
                        <Pencil size={14} />
                      </button>
                    </div>
                    {secret.username ? <p className="mt-1 text-xs text-ink-600">Usuari: <span className="font-mono">{secret.username}</span></p> : null}
                    <div className="mt-1">
                      <SecretValue reveal={() => equipmentApi.revealSecret(secret.id)} />
                    </div>
                    {secret.notes ? <p className="mt-1 text-xs text-ink-500">{secret.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : item.secretCount > 0 ? (
          <p className="text-xs text-ink-500">
            <Lock size={12} className="mr-1 inline" aria-hidden="true" />
            Aquest equip té {item.secretCount} credencials desades (només les veu qui gestiona els equips).
          </p>
        ) : null}

        <p className="border-t border-ink-100 pt-3 text-xs text-ink-400">
          Creat per {item.createdByName}
          {item.updatedByName ? ` · última modificació de ${item.updatedByName}, ${formatDateTime(item.updatedAt)}` : ''}
        </p>
      </div>

      {dialog?.kind === 'check' ? (
        <CheckDialog
          equipment={item}
          check={dialog.check}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}
      {dialog?.kind === 'secret' ? (
        <SecretDialog
          equipmentId={item.id}
          secret={dialog.secret}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-ink-900">{children ?? <span className="text-ink-300">—</span>}</dd>
    </>
  );
}

function CheckRow({ check, manager, onEdit, onChanged }: { check: EquipmentCheck; manager: boolean; onEdit: () => void; onChanged: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const outcome = await equipmentApi.runCheck(check.id);
      setResult(outcome.ok ? `OK${outcome.latencyMs !== null ? ` · ${outcome.latencyMs} ms` : ''}` : outcome.error ?? 'Ha fallat');
      onChanged();
    } catch (reason) {
      setResult(readError(reason));
    } finally {
      setRunning(false);
    }
  }

  const state = check.enabled ? check.state : 'NONE';
  return (
    <li className={clsx('rounded-lg border px-3 py-2', check.state === 'DOWN' && check.enabled ? 'border-red-200 bg-red-50/50' : 'border-ink-200')}>
      <div className="flex items-center gap-2">
        <NetDot state={state} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900" title={check.label}>
          {check.label}
        </span>
        <button type="button" onClick={run} disabled={running} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50" title="Prova-ho ara">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Ara
        </button>
        {manager ? (
          <button type="button" onClick={onEdit} className="text-ink-400 hover:text-ink-800" aria-label="Edita la prova">
            <Pencil size={14} />
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {!check.enabled
          ? 'Desactivada'
          : check.lastRunAt
            ? `${check.lastOk === null ? 'No s’ha pogut provar' : check.lastOk ? 'OK' : 'Ha fallat'} ${since(check.lastRunAt)}${check.lastLatencyMs !== null && check.lastOk ? ` · ${check.lastLatencyMs} ms` : ''}`
            : 'Encara no s’ha provat'}
        {check.enabled ? ` · cada ${Math.round(check.intervalSec / 60)} min` : ''}
        {check.uptime30 !== null ? ` · ${(check.uptime30 * 100).toFixed(check.uptime30 === 1 ? 0 : 1)} % (30 dies)` : ''}
      </p>
      {check.state === 'DOWN' && check.stateSince ? <p className="text-xs font-medium text-danger">No respon des de {formatDateTime(check.stateSince)}</p> : null}
      {check.lastError && check.enabled ? <p className="text-xs text-danger">{check.lastError}</p> : null}
      {check.certExpiresAt ? <p className="text-xs text-ink-500">Certificat fins al {formatDateTime(check.certExpiresAt)}</p> : null}
      {result ? <p className="mt-1 text-xs font-medium text-ink-700">Ara: {result}</p> : null}
    </li>
  );
}

/** Disponibilitat dels últims 30 dies (una barra per dia) i els últims canvis d'estat. */
function History({ equipmentId, checks }: { equipmentId: string; checks: EquipmentCheck[] }) {
  const query = useQuery({ queryKey: ['equipment', 'history', equipmentId], queryFn: () => equipmentApi.history(equipmentId), refetchInterval: 60_000 });
  const data = query.data;
  if (!data) return query.isLoading ? <p className="mt-2 text-xs text-ink-400">Carregant historial…</p> : null;

  const days: string[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    days.push(new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-CA'));
  }
  const byDay = new Map<string, { ok: number; fail: number }>();
  for (const row of data.daily) {
    const current = byDay.get(row.day) ?? { ok: 0, fail: 0 };
    byDay.set(row.day, { ok: current.ok + row.okCount, fail: current.fail + row.failCount });
  }
  const label = new Map(checks.map((check) => [check.id, check.label]));

  return (
    <div className="mt-3 space-y-2">
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-600">
          <Activity size={12} aria-hidden="true" /> Últims 30 dies
        </p>
        <div className="flex h-6 items-end gap-[2px]" role="img" aria-label="Disponibilitat per dia">
          {days.map((day) => {
            const value = byDay.get(day);
            const total = value ? value.ok + value.fail : 0;
            const ratio = total ? value!.ok / total : null;
            return (
              <span
                key={day}
                title={`${day}: ${ratio === null ? 'sense dades' : `${(ratio * 100).toFixed(1)} % OK`}`}
                className={clsx(
                  'h-full flex-1 rounded-sm',
                  ratio === null ? 'bg-ink-100' : ratio >= 0.99 ? 'bg-emerald-500' : ratio >= 0.9 ? 'bg-amber-400' : 'bg-red-500',
                )}
              />
            );
          })}
        </div>
      </div>
      {data.events.length ? (
        <ul className="space-y-0.5 text-xs">
          {data.events.slice(0, 8).map((event) => (
            <li key={event.id} className={event.state === 'DOWN' ? 'text-danger' : 'text-emerald-700'}>
              {formatDateTime(event.at)} · {event.state === 'DOWN' ? 'Ha caigut' : 'Torna a respondre'}
              <span className="text-ink-500"> ({label.get(event.checkId) ?? 'prova'}){event.error ? ` — ${event.error}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

