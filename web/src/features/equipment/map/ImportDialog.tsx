import { useMemo, useState } from 'react';
import { Check, FileUp } from 'lucide-react';

import { Field, GhostButton, Modal, PrimaryButton } from '@/components/ui';
import { ROLE_LABEL, guessMetersPerUnit, guessRole, rawExtent, rawToScene, type ImportOptions, type LayerRole, type RawPlan } from './importers';
import type { MapScene } from './scene';

const UNITS: { label: string; value: number }[] = [
  { label: 'Metres', value: 1 },
  { label: 'Centímetres', value: 0.01 },
  { label: 'Mil·límetres', value: 0.001 },
  { label: 'Polzades', value: 0.0254 },
  { label: 'Peus', value: 0.3048 },
];

/** Tria què és cada capa d'un plànol DXF/SVG i a quina escala, i genera l'escena editable. */
export function ImportDialog({ plan, base, onClose, onApply }: { plan: RawPlan; base: MapScene; onClose: () => void; onApply: (scene: MapScene) => void }) {
  const [roles, setRoles] = useState<Record<string, LayerRole>>(() => Object.fromEntries(plan.layers.map((layer) => [layer.name, guessRole(layer)])));
  const initialScale = guessMetersPerUnit(plan);
  const [unit, setUnit] = useState<number>(UNITS.find((item) => item.value === initialScale)?.value ?? -1);
  const [custom, setCustom] = useState(initialScale);
  const [wallHeight, setWallHeight] = useState(4);
  const [boxHeight, setBoxHeight] = useState(1.5);
  const [textsAsCodes, setTextsAsCodes] = useState(true);
  const [append, setAppend] = useState(false);
  const metersPerUnit = unit > 0 ? unit : custom;

  const size = useMemo(() => {
    const extent = rawExtent(plan, roles);
    return { w: (extent.maxX - extent.minX) * metersPerUnit, d: (extent.maxY - extent.minY) * metersPerUnit };
  }, [plan, roles, metersPerUnit]);

  function apply() {
    const options: ImportOptions = { metersPerUnit, roles, wallHeight, boxHeight, textsAsCodes, append };
    onApply(rawToScene(plan, options, base));
  }

  const selectedCount = plan.layers.filter((layer) => roles[layer.name] !== 'ignore').length;

  return (
    <Modal
      wide
      title={`Importa ${plan.source}`}
      subtitle="Tria què és cada capa. Després ho podràs editar tot: moure, esborrar, canviar alçades, posar codis…"
      icon={<FileUp size={18} />}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel·la</GhostButton>
          <PrimaryButton onClick={apply} disabled={!selectedCount}>
            <Check size={16} /> {append ? 'Afegeix al mapa' : 'Substitueix el mapa'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Unitats del fitxer">
            <select value={unit} onChange={(event) => setUnit(Number(event.target.value))} className="h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-sm">
              {UNITS.map((item) => (
                <option key={item.label} value={item.value}>
                  {item.label}
                </option>
              ))}
              <option value={-1}>Altra escala…</option>
            </select>
            {unit <= 0 ? (
              <input
                type="number"
                step="any"
                value={custom}
                onChange={(event) => setCustom(Number(event.target.value) || 1)}
                className="mt-1 h-9 w-full rounded-lg border border-ink-200 px-2 text-sm"
                title="Metres per unitat del fitxer"
              />
            ) : null}
          </Field>
          <Field label="Alçada de parets" hint="(m)">
            <input type="number" step={0.1} min={0.1} value={wallHeight} onChange={(event) => setWallHeight(Number(event.target.value) || 3)} className="h-9 w-full rounded-lg border border-ink-200 px-2 text-sm" />
          </Field>
          <Field label="Alçada de blocs" hint="(m)">
            <input type="number" step={0.1} min={0.05} value={boxHeight} onChange={(event) => setBoxHeight(Number(event.target.value) || 1)} className="h-9 w-full rounded-lg border border-ink-200 px-2 text-sm" />
          </Field>
          <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            Mida: <strong className="tabular-nums">{size.w.toFixed(1)} × {size.d.toFixed(1)} m</strong>
            {size.w > 2000 || size.d > 2000 ? <p className="text-xs text-amber-700">Massa gran: revisa les unitats.</p> : null}
            {size.w < 2 && size.d < 2 ? <p className="text-xs text-amber-700">Massa petit: revisa les unitats.</p> : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-200">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Capa</th>
                <th className="px-3 py-2 text-right">Línies</th>
                <th className="px-3 py-2 text-right">Tancades</th>
                <th className="px-3 py-2 text-right">Textos</th>
                <th className="px-3 py-2">És…</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {plan.layers.map((layer) => (
                <tr key={layer.name} className={roles[layer.name] === 'ignore' ? 'text-ink-400' : ''}>
                  <td className="max-w-[16rem] truncate px-3 py-1.5 font-medium" title={layer.name}>
                    {layer.name}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{layer.paths.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{layer.closed.filter(Boolean).length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{layer.texts.length}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={roles[layer.name]}
                      onChange={(event) => setRoles((current) => ({ ...current, [layer.name]: event.target.value as LayerRole }))}
                      className="h-8 w-full rounded-md border border-ink-200 bg-white px-1.5 text-sm"
                    >
                      {(Object.keys(ROLE_LABEL) as LayerRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-1.5 text-sm text-ink-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={textsAsCodes} onChange={(event) => setTextsAsCodes(event.target.checked)} />
            Els textos curts que cauen dins d’un bloc en són el codi (per enganxar-hi equips en ubicar-los)
          </label>
          {base.elements.length ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={append} onChange={(event) => setAppend(event.target.checked)} />
              Afegeix-ho al que ja hi ha (si no, substitueix els {base.elements.length} elements actuals; els equips ubicats es mantenen)
            </label>
          ) : null}
          <p className="text-xs text-ink-500">
            Blocs: cada polilínia tancada es converteix en un bloc (estanteria, màquina…); les obertes queden com a línies. Els fitxers DWG s’han de desar abans
            com a DXF (AutoCAD, LibreCAD o el convertidor gratuït ODA File Converter).
          </p>
        </div>
      </div>
    </Modal>
  );
}
