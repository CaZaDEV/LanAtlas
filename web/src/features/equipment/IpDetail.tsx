import { Check, Copy, ExternalLink, Loader2, Plus, ScanSearch, X } from 'lucide-react';
import clsx from 'clsx';

import type { Equipment, EquipmentDraft, EquipmentState, IpDiscovery } from '@/api/equipment';
import { formatDateTime } from './equipmentUi';

const CONFIDENCE_STYLE: Record<IpDiscovery['guess']['confidence'], string> = {
  alta: 'bg-emerald-100 text-emerald-800',
  mitjana: 'bg-amber-100 text-amber-800',
  baixa: 'bg-ink-100 text-ink-600',
};

/** Nom més útil de l'aparell: el de Windows, després DNS/mDNS/SNMP. */
export function discoveryName(discovery: IpDiscovery): string | null {
  return discovery.names[0]?.name ?? null;
}

/** Text curt per a la casella de la quadrícula. */
export function discoveryShort(discovery: IpDiscovery): string {
  if (!discovery.alive) return 'No respon';
  return discoveryName(discovery) ?? discovery.guess.label;
}

/** «Nou equip» omplert amb el que s'ha trobat; queda «A revisar». */
export function draftFromDiscovery(discovery: IpDiscovery, state: EquipmentState): EquipmentDraft {
  const typeId = state.types.some((type) => type.id === discovery.guess.typeId) ? discovery.guess.typeId : (state.types[0]?.id ?? '');
  const notes = [
    `Trobat a la pestanya IPs el ${formatDateTime(discovery.at)} (${discovery.guess.label}, confiança ${discovery.guess.confidence}).`,
    discovery.names.length ? `Noms: ${discovery.names.map((row) => `${row.name} (${row.source})`).join(', ')}.` : null,
    discovery.workgroup ? `Grup de treball: ${discovery.workgroup}.` : null,
    discovery.snmp?.location ? `Ubicació (SNMP): ${discovery.snmp.location}.` : null,
    discovery.ports.length ? `Ports oberts: ${discovery.ports.map((row) => `${row.port} ${row.service}`).join(', ')}.` : null,
    ...discovery.web.map((row) => `Web ${row.scheme}:${row.port}: ${[row.title, row.server, row.realm].filter(Boolean).join(' · ') || `estat ${row.status ?? '?'}`}.`),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    name: discoveryName(discovery) ?? `${discovery.guess.label} ${discovery.ip}`,
    typeId,
    model: discovery.snmp?.descr?.split(/[\r\n]/)[0].slice(0, 120) ?? null,
    location: discovery.snmp?.location?.slice(0, 120) ?? null,
    os: discovery.guess.typeId === 'type-pc' ? 'Windows' : null,
    notes,
    ip: discovery.ip,
    mac: discovery.mac,
    reviewNote: 'Donat d’alta des de l’escaneig d’IPs: comprovar què és i completar la fitxa.',
  };
}

export function IpDetail({
  ip,
  kindLabel,
  owners,
  discovery,
  identifying,
  copied,
  manager,
  onIdentify,
  onCopy,
  onOpenEquipment,
  onCreate,
  onClose,
}: {
  ip: string;
  kindLabel: string;
  owners: Equipment[];
  discovery: IpDiscovery | undefined;
  identifying: boolean;
  copied: boolean;
  manager: boolean;
  onIdentify: () => void;
  onCopy: () => void;
  onOpenEquipment: (id: string) => void;
  onCreate: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-mono text-lg font-bold text-ink-900">
            {ip}
            <button type="button" onClick={onCopy} title="Copia l’IP" className="text-ink-400 hover:text-brand-600">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </h3>
          <p className="text-sm text-ink-600">{kindLabel}</p>
        </div>
        <button
          type="button"
          onClick={onIdentify}
          disabled={identifying}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60"
          title="DNS, nom de Windows, SNMP, ports, web i salutacions dels serveis"
        >
          {identifying ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />}
          {identifying ? 'Identificant…' : discovery ? 'Torna a identificar' : 'Identifica'}
        </button>
        {manager && onCreate && discovery?.alive ? (
          <button type="button" onClick={onCreate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
            <Plus size={16} /> Dona d’alta
          </button>
        ) : null}
        <button type="button" onClick={onClose} title="Tanca" className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <X size={18} />
        </button>
      </div>

      {owners.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {owners.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenEquipment(item.id)} className="rounded-md bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-800 hover:bg-brand-50 hover:text-brand-700">
              {item.name}
              {item.status === 'RETIRED' ? ' (de baixa)' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {discovery ? (
        discovery.alive ? (
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink-900">{discovery.guess.label}</span>
              <span className={clsx('rounded-md px-1.5 py-0.5 text-xs font-semibold', CONFIDENCE_STYLE[discovery.guess.confidence])}>confiança {discovery.guess.confidence}</span>
              <span className="text-xs text-ink-500">
                {formatDateTime(discovery.at)} · {Math.round(discovery.durationMs / 100) / 10} s
              </span>
            </div>
            <ul className="list-inside list-disc text-xs text-ink-600">
              {discovery.guess.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
              {discovery.names.length ? (
                <>
                  <dt className="text-ink-500">Noms</dt>
                  <dd className="text-ink-900">
                    {discovery.names.map((row) => (
                      <span key={row.name} className="mr-2 inline-block">
                        <strong>{row.name}</strong> <span className="text-xs text-ink-500">({row.source})</span>
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
              {discovery.mac ? (
                <>
                  <dt className="text-ink-500">MAC</dt>
                  <dd className="font-mono text-ink-900">{discovery.mac}</dd>
                </>
              ) : null}
              {discovery.workgroup ? (
                <>
                  <dt className="text-ink-500">Grup de treball</dt>
                  <dd className="text-ink-900">{discovery.workgroup}</dd>
                </>
              ) : null}
              {discovery.snmp?.descr ? (
                <>
                  <dt className="text-ink-500">Descripció (SNMP)</dt>
                  <dd className="whitespace-pre-wrap text-ink-900">{discovery.snmp.descr}</dd>
                </>
              ) : null}
              {discovery.snmp?.location || discovery.snmp?.contact ? (
                <>
                  <dt className="text-ink-500">Ubicació (SNMP)</dt>
                  <dd className="text-ink-900">{[discovery.snmp.location, discovery.snmp.contact].filter(Boolean).join(' · ')}</dd>
                </>
              ) : null}
              <dt className="text-ink-500">Ports oberts</dt>
              <dd className="flex flex-wrap gap-1">
                {discovery.ports.length
                  ? discovery.ports.map((row) => (
                      <span key={row.port} className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-800" title={row.service}>
                        <strong className="font-mono">{row.port}</strong> {row.service}
                      </span>
                    ))
                  : <span className="text-ink-500">Cap dels habituals</span>}
              </dd>
              {discovery.web.map((row) => (
                <div key={`${row.scheme}${row.port}`} className="contents">
                  <dt className="text-ink-500">Web {row.port}</dt>
                  <dd className="min-w-0 text-ink-900">
                    <a href={`${row.scheme}://${ip}:${row.port}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                      {row.title || `${row.scheme}://${ip}:${row.port}`} <ExternalLink size={12} />
                    </a>
                    <span className="block text-xs text-ink-500">
                      {[row.status ? `estat ${row.status}` : null, row.server, row.realm ? `demana usuari: «${row.realm}»` : null, row.location ? `redirigeix a ${row.location}` : null, row.certSubject ? `certificat ${row.certSubject}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </dd>
                </div>
              ))}
              {discovery.banners.map((row) => (
                <div key={row.port} className="contents">
                  <dt className="text-ink-500">Salutació {row.port}</dt>
                  <dd className="whitespace-pre-wrap break-all font-mono text-xs text-ink-800">{row.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-600">
            No respon a res (ni ping, ni ports, ni noms). Pot estar apagat o no haver-hi res: es pot assignar, però si és un aparell que només s’engega a estones
            ho sabràs quan torni.
          </p>
        )
      ) : identifying ? (
        <p className="mt-3 text-sm text-ink-500">Provant DNS, nom de Windows, SNMP, ports, web i serveis… (uns 5 s)</p>
      ) : (
        <p className="mt-3 text-sm text-ink-500">«Identifica» llança totes les proves (només lectura) per saber quin aparell hi ha en aquesta IP.</p>
      )}
    </section>
  );
}
