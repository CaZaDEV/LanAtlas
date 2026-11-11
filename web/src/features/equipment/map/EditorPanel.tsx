import { useState, type ReactNode } from 'react';
import { Copy, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { KIND_LABEL, newId, sceneWeight, translateElement, type MapScene, type SceneElement, type SceneLayer } from './scene';

/** Panell lateral de l'editor: propietats de l'element triat o, si no n'hi ha cap, les capes i l'ajuda. */
export function EditorPanel({
  scene,
  selected,
  onChange,
  onChangeScene,
  onSelect,
}: {
  scene: MapScene;
  selected: SceneElement | null;
  onChange: (element: SceneElement) => void;
  onChangeScene: (scene: MapScene) => void;
  onSelect: (id: string | null) => void;
}) {
  if (selected) {
    return (
      <Properties
        key={selected.id}
        element={selected}
        layers={scene.layers}
        onChange={onChange}
        onDelete={() => {
          onChangeScene({ ...scene, elements: scene.elements.filter((item) => item.id !== selected.id) });
          onSelect(null);
        }}
        onDuplicate={() => {
          const copy = { ...translateElement(selected, 1, 1), id: newId(), code: null } as SceneElement;
          onChangeScene({ ...scene, elements: [...scene.elements, copy] });
          onSelect(copy.id);
        }}
        onClose={() => onSelect(null)}
      />
    );
  }
  return <Layers scene={scene} onChangeScene={onChangeScene} />;
}

function NumberInput({ label, value, onChange, step = 0.1, min, suffix }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; suffix?: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {label}
        {suffix ? <span className="normal-case"> ({suffix})</span> : null}
      </span>
      <input
        type="number"
        step={step}
        min={min}
        value={focused ? text : String(Math.round(value * 1000) / 1000)}
        onFocus={() => {
          setFocused(true);
          setText(String(Math.round(value * 1000) / 1000));
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(next) && (min === undefined || next >= min)) onChange(next);
        }}
        className="mt-0.5 h-8 w-full rounded-md border border-ink-200 px-2 text-sm tabular-nums outline-none focus:border-brand-400"
      />
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={clsx('mt-0.5 h-8 w-full rounded-md border border-ink-200 px-2 text-sm outline-none focus:border-brand-400', mono && 'font-mono')}
      />
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Color</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="mt-0.5 h-8 w-full cursor-pointer rounded-md border border-ink-200 bg-white p-0.5" />
    </label>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Properties({
  element,
  layers,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
}: {
  element: SceneElement;
  layers: SceneLayer[];
  onChange: (element: SceneElement) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<SceneElement>) => onChange({ ...element, ...patch } as SceneElement);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{KIND_LABEL[element.kind]}</p>
          <p className="truncate font-semibold text-ink-900">{element.label || element.code || ('text' in element ? element.text : null) || ('fileName' in element ? element.fileName : null) || 'Sense nom'}</p>
        </div>
        <button type="button" onClick={() => set({ locked: !element.locked })} className="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-ink-100" title={element.locked ? 'Desbloqueja' : 'Bloqueja (no es pot moure)'}>
          {element.locked ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        <button type="button" onClick={onDuplicate} className="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-ink-100" title="Duplica">
          <Copy size={15} />
        </button>
        <button type="button" onClick={onDelete} className="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-red-50 hover:text-danger" title="Esborra (Supr)">
          <Trash2 size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Capa</span>
          <select value={element.layer} onChange={(event) => set({ layer: event.target.value })} className="mt-0.5 h-8 w-full rounded-md border border-ink-200 bg-white px-2 text-sm">
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>

        {element.kind === 'label' ? (
          <>
            <TextInput label="Text" value={element.text} onChange={(text) => set({ text })} />
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={element.size === 'small'} onChange={(event) => set({ size: event.target.checked ? 'small' : 'normal' })} /> Text petit
            </label>
          </>
        ) : (
          <Grid>
            <TextInput label="Etiqueta" value={element.label ?? ''} onChange={(value) => set({ label: value || null })} />
            <TextInput label="Codi" value={element.code ?? ''} placeholder="RACK-3" mono onChange={(value) => set({ code: value.replace(/[^0-9A-Za-z._-]/g, '').slice(0, 24).toUpperCase() || null })} />
          </Grid>
        )}

        {element.kind === 'box' ? (
          <>
            <Grid>
              <NumberInput label="X" suffix="m" value={element.x} onChange={(x) => set({ x })} />
              <NumberInput label="Y" suffix="m" value={element.y} onChange={(y) => set({ y })} />
              <NumberInput label="Amplada" suffix="m" min={0.02} value={element.w} onChange={(w) => set({ w })} />
              <NumberInput label="Fons" suffix="m" min={0.02} value={element.d} onChange={(d) => set({ d })} />
              <NumberInput label="Alçada" suffix="m" min={0.01} value={element.h} onChange={(h) => set({ h })} />
              <NumberInput label="Gir" suffix="°" step={5} value={element.rotation} onChange={(rotation) => set({ rotation })} />
              <ColorInput value={element.color} onChange={(color) => set({ color })} />
              <NumberInput label="Opacitat" step={0.05} min={0.05} value={element.opacity} onChange={(opacity) => set({ opacity: Math.min(1, opacity) })} />
            </Grid>
            {element.outline ? (
              <button type="button" onClick={() => set({ outline: undefined })} className="text-xs font-medium text-ink-500 hover:underline">
                Treu el contorn importat
              </button>
            ) : null}
          </>
        ) : null}

        {element.kind === 'wall' ? (
          <Grid>
            <NumberInput label="Alçada" suffix="m" min={0.05} value={element.height} onChange={(height) => set({ height })} />
            <NumberInput label="Opacitat" step={0.05} min={0.05} value={element.opacity} onChange={(opacity) => set({ opacity: Math.min(1, opacity) })} />
            <ColorInput value={element.color} onChange={(color) => set({ color })} />
            <p className="self-end text-xs text-ink-500">{element.paths.length} trams</p>
          </Grid>
        ) : null}

        {element.kind === 'zone' ? (
          <Grid>
            <ColorInput value={element.color} onChange={(color) => set({ color })} />
            <NumberInput label="Opacitat" step={0.05} min={0.02} value={element.opacity} onChange={(opacity) => set({ opacity: Math.min(1, opacity) })} />
          </Grid>
        ) : null}

        {element.kind === 'lines' ? (
          <Grid>
            <ColorInput value={element.color} onChange={(color) => set({ color })} />
            <p className="self-end text-xs text-ink-500">{element.paths.length} línies</p>
          </Grid>
        ) : null}

        {element.kind === 'model' ? (
          <Grid>
            <NumberInput label="X" suffix="m" value={element.x} onChange={(x) => set({ x })} />
            <NumberInput label="Y" suffix="m" value={element.y} onChange={(y) => set({ y })} />
            <NumberInput label="Alçada base" suffix="m" value={element.z} onChange={(z) => set({ z })} />
            <NumberInput label="Gir" suffix="°" step={5} value={element.rotation} onChange={(rotation) => set({ rotation })} />
            <NumberInput label="Escala" step={0.01} min={0.0001} value={element.scale} onChange={(scale) => set({ scale })} />
            <ColorInput value={element.color} onChange={(color) => set({ color })} />
            <div className="col-span-2 flex flex-wrap gap-1">
              {[
                ['mm → m', 0.001],
                ['cm → m', 0.01],
                ['polzades → m', 0.0254],
                ['m', 1],
              ].map(([text, value]) => (
                <button key={text} type="button" onClick={() => set({ scale: value as number })} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700 hover:bg-ink-200">
                  {text}
                </button>
              ))}
            </div>
          </Grid>
        ) : null}

        {element.kind === 'image' ? (
          <Grid>
            <NumberInput label="X" suffix="m" value={element.x} onChange={(x) => set({ x })} />
            <NumberInput label="Y" suffix="m" value={element.y} onChange={(y) => set({ y })} />
            <NumberInput
              label="Amplada"
              suffix="m"
              min={0.1}
              value={element.w}
              onChange={(w) => set({ w, d: Math.round(((element.d * w) / element.w) * 1000) / 1000 })}
            />
            <NumberInput label="Fons" suffix="m" min={0.1} value={element.d} onChange={(d) => set({ d })} />
            <NumberInput label="Gir" suffix="°" step={5} value={element.rotation} onChange={(rotation) => set({ rotation })} />
            <NumberInput label="Opacitat" step={0.05} min={0.05} value={element.opacity} onChange={(opacity) => set({ opacity: Math.min(1, opacity) })} />
            <p className="col-span-2 text-xs text-ink-500">Canviar l’amplada manté la proporció. Calibra-la amb «Mesura» sobre una cota coneguda.</p>
          </Grid>
        ) : null}

        <p className="text-xs text-ink-500">
          Mou, gira o escala amb les manetes (teclat: <kbd>G</kbd> moure, <kbd>R</kbd> girar, <kbd>S</kbd> escalar). <kbd>Supr</kbd> esborra, <kbd>Ctrl+D</kbd> duplica.
        </p>
      </div>
      <div className="border-t border-ink-100 px-4 py-2 text-right">
        <button type="button" onClick={onClose} className="text-sm font-medium text-brand-600 hover:underline">
          Fet
        </button>
      </div>
    </div>
  );
}

function Layers({ scene, onChangeScene }: { scene: MapScene; onChangeScene: (scene: MapScene) => void }) {
  const counts = new Map<string, number>();
  for (const element of scene.elements) counts.set(element.layer, (counts.get(element.layer) ?? 0) + 1);
  const weight = sceneWeight(scene);
  const setLayer = (id: string, patch: Partial<SceneLayer>) => onChangeScene({ ...scene, layers: scene.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h2 className="font-semibold text-ink-900">Capes</h2>
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Nom de la capa nova')?.trim();
            if (name) onChangeScene({ ...scene, layers: [...scene.layers, { id: newId('layer'), name: name.slice(0, 60), visible: true }] });
          }}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
        >
          <Plus size={14} /> Nova
        </button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-ink-100 overflow-auto">
        {scene.layers.map((layer) => (
          <li key={layer.id} className="flex items-center gap-2 px-4 py-2">
            <button type="button" onClick={() => setLayer(layer.id, { visible: !layer.visible })} className="text-ink-500 hover:text-ink-900" aria-label={layer.visible ? 'Amaga' : 'Mostra'}>
              {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <input
              value={layer.name}
              onChange={(event) => setLayer(layer.id, { name: event.target.value.slice(0, 60) })}
              className={clsx('min-w-0 flex-1 rounded px-1 text-sm outline-none focus:bg-ink-50', !layer.visible && 'text-ink-400')}
              aria-label="Nom de la capa"
            />
            <span className="text-xs tabular-nums text-ink-400">{counts.get(layer.id) ?? 0}</span>
            <button
              type="button"
              disabled={scene.layers.length <= 1}
              onClick={() => {
                const count = counts.get(layer.id) ?? 0;
                if (count && !window.confirm(`Esborrar la capa «${layer.name}» i els seus ${count} elements?`)) return;
                onChangeScene({ ...scene, layers: scene.layers.filter((item) => item.id !== layer.id), elements: scene.elements.filter((item) => item.layer !== layer.id) });
              }}
              className="text-ink-400 hover:text-danger disabled:opacity-30"
              aria-label="Esborra la capa"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
        <p>
          {scene.elements.length} elements · {Math.round(weight).toLocaleString()} vèrtexs
          {weight > 400_000 ? <span className="text-amber-700"> · escena pesada: amaga o esborra capes de detall</span> : null}
        </p>
        <p className="font-semibold text-ink-700">Com funciona</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Importa un plànol DXF o SVG (tries què és cada capa), una imatge per calcar-hi a sobre o models 3D (GLB, OBJ, STL, FBX…).</li>
          <li>Dibuixa parets i zones amb clics (doble clic o Retorn per acabar, Retrocés desfà el punt) i blocs arrossegant.</li>
          <li>Posa un «Codi» als blocs (RACK-3, 049A…): en ubicar un equip a sobre, s’hi enganxa.</li>
          <li>Botó dret: girar la vista · roda: zoom. Ctrl+Z / Ctrl+Y desfer i refer.</li>
        </ul>
      </div>
    </div>
  );
}
