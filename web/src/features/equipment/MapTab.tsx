import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Crosshair,
  Download,
  Expand,
  FileUp,
  Grid3x3,
  Layers,
  Loader2,
  Map as MapIcon,
  MapPin,
  MapPinOff,
  Maximize2,
  MousePointer2,
  Move,
  PenLine,
  Pencil,
  Plus,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Search,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';

import { readError } from '@/api/client';
import { equipmentApi, mapsApi, type Equipment, type EquipmentState } from '@/api/equipment';
import { EquipmentPanel } from './EquipmentPanel';
import { NetDot, TypeIcon, fold, matchesQuery, searchHaystack } from './equipmentUi';
import { EditorPanel } from './map/EditorPanel';
import { ImportDialog } from './map/ImportDialog';
import { ACCEPT, fileKind, parseDxf, parseSvg, type RawPlan } from './map/importers';
import { emptyScene, newId, normalizeScene, sceneBounds, translateElement, type MapScene, type SceneElement } from './map/scene';
import type { PlacePoint, SceneMarker, Tool, TransformMode } from './map/MapScene';

// three.js i l'editor només es baixen en obrir el mapa.
const MapSceneView = lazy(() => import('./map/MapScene'));

export interface MapRequest {
  id: string;
  place: boolean;
  token: number;
}

const HISTORY = 100;

const TOOLS: { key: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { key: 'select', label: 'Selecciona', icon: MousePointer2, hint: 'Clic en un element per editar-lo i moure’l amb les manetes' },
  { key: 'wall', label: 'Paret', icon: PenLine, hint: 'Clics per posar punts; doble clic o Retorn per acabar' },
  { key: 'zone', label: 'Zona', icon: Grid3x3, hint: 'Clics per posar els vèrtexs; clic al primer punt, doble clic o Retorn per tancar' },
  { key: 'box', label: 'Bloc', icon: Square, hint: 'Arrossega per dibuixar un bloc (estanteria, màquina, moble…)' },
  { key: 'label', label: 'Text', icon: Type, hint: 'Clic on vols posar el text' },
  { key: 'measure', label: 'Mesura', icon: Ruler, hint: 'Clic a dos punts per mesurar la distància' },
];

/** Pestanya Mapa: els mapes 3D amb els equips ubicats, el mode per ubicar-los i l'editor del plànol. */
export function MapTab({
  state,
  request,
  selectedId,
  onSelect,
  onEdit,
  onChanged,
}: {
  state: EquipmentState;
  request: MapRequest | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (item: Equipment) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [mapId, setMapId] = useState<string | null>(state.maps[0]?.id ?? null);
  useEffect(() => {
    if (!state.maps.length) setMapId(null);
    else if (!mapId || !state.maps.some((map) => map.id === mapId)) setMapId(state.maps[0].id);
  }, [state.maps, mapId]);

  const mapQuery = useQuery({
    queryKey: ['map', mapId],
    queryFn: () => mapsApi.get<unknown>(mapId!),
    enabled: !!mapId,
    staleTime: Infinity,
  });

  // Escena de treball (es desa amb «Desa»), historial per desfer i estat de l'editor.
  const [scene, setScene] = useState<MapScene>(emptyScene);
  const [past, setPast] = useState<MapScene[]>([]);
  const [future, setFuture] = useState<MapScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>('view');
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [measure, setMeasure] = useState<number | null>(null);
  const [rawPlan, setRawPlan] = useState<RawPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mapQuery.data) return;
    setScene(normalizeScene(mapQuery.data.scene));
    setPast([]);
    setFuture([]);
    setDirty(false);
    setSelectedElementId(null);
  }, [mapQuery.data]);

  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [showLayers, setShowLayers] = useState(false);
  const [search, setSearch] = useState('');
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [unplacedQuery, setUnplacedQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const types = useMemo(() => new Map(state.types.map((type) => [type.id, type])), [state.types]);
  const licenses = useMemo(() => new Map(state.licenses.map((license) => [license.id, license])), [state.licenses]);
  const placed = useMemo(
    () => state.equipment.filter((item) => item.mapId === mapId && item.mapX !== null && item.mapY !== null),
    [state.equipment, mapId],
  );
  const unplaced = state.equipment.filter((item) => (item.mapX === null || item.mapY === null || !item.mapId) && item.status !== 'RETIRED');
  const placing = placingId ? state.equipment.find((item) => item.id === placingId) ?? null : null;
  const selected = selectedId ? state.equipment.find((item) => item.id === selectedId) ?? null : null;
  const selectedElement = selectedElementId ? scene.elements.find((element) => element.id === selectedElementId) ?? null : null;

  const markers: SceneMarker[] = useMemo(
    () => placed.map((item) => ({ id: item.id, name: item.name, x: item.mapX!, y: item.mapY!, state: item.netState, critical: item.critical })),
    [placed],
  );
  const highlight = useMemo(() => {
    if (!search.trim()) return null;
    return new Set(placed.filter((item) => matchesQuery(searchHaystack(item, types, licenses), search)).map((item) => item.id));
  }, [search, placed, types, licenses]);

  /** Canvi editable de l'escena (amb desfer). */
  const commit = useCallback(
    (next: MapScene) => {
      setPast((list) => [...list.slice(-HISTORY + 1), scene]);
      setFuture([]);
      setScene(next);
      setDirty(true);
    },
    [scene],
  );

  const changeElement = useCallback(
    (element: SceneElement) => commit({ ...scene, elements: scene.elements.map((item) => (item.id === element.id ? element : item)) }),
    [commit, scene],
  );

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((list) => list.slice(0, -1));
    setFuture((list) => [scene, ...list]);
    setScene(previous);
    setDirty(true);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((list) => list.slice(1));
    setPast((list) => [...list, scene]);
    setScene(next);
    setDirty(true);
  }

  // Petició des de la llista o la fitxa: «Veure al mapa» / «Ubica al mapa».
  useEffect(() => {
    if (!request) return;
    onSelect(request.id);
    const item = state.equipment.find((row) => row.id === request.id);
    if (item?.mapId && item.mapId !== mapId) setMapId(item.mapId);
    if (request.place) {
      setEditing(false);
      setPlacingId(request.id);
    } else setFocusToken((token) => token + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token]);

  useEffect(() => {
    if (placingId) setTool('place');
    else setTool((current) => (current === 'place' ? (editing ? 'select' : 'view') : current));
  }, [placingId, editing]);

  async function saveScene() {
    if (!mapId || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await mapsApi.update(mapId, { scene });
      setDirty(false);
      queryClient.setQueryData(['map', mapId], (current: unknown) => (current ? { ...(current as object), scene } : current));
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setSaving(false);
    }
  }

  function duplicate(element: SceneElement) {
    const copy = { ...translateElement(element, 1, 1), id: newId(), code: null } as SceneElement;
    commit({ ...scene, elements: [...scene.elements, copy] });
    setSelectedElementId(copy.id);
  }

  // Teclat de l'editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === 'Escape') {
        if (placingId) setPlacingId(null);
        else if (selectedElementId) setSelectedElementId(null);
        else if (editing && tool !== 'select') setTool('select');
      }
      if (!editing) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (ctrl && key === 'y') {
        event.preventDefault();
        redo();
      } else if (ctrl && key === 's') {
        event.preventDefault();
        void saveScene();
      } else if (ctrl && key === 'd' && selectedElement) {
        event.preventDefault();
        duplicate(selectedElement);
      } else if ((event.key === 'Delete' || (event.key === 'Backspace' && tool === 'select')) && selectedElement) {
        event.preventDefault();
        commit({ ...scene, elements: scene.elements.filter((item) => item.id !== selectedElement.id) });
        setSelectedElementId(null);
      } else if (!ctrl && tool === 'select' && selectedElement) {
        if (key === 'g') setTransformMode('translate');
        if (key === 'r') setTransformMode('rotate');
        if (key === 's') setTransformMode('scale');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Avís en tancar la pestanya amb canvis sense desar.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('Hi ha canvis del plànol sense desar. Els vols descartar?');
  }

  function startEditing() {
    setPlacingId(null);
    setEditing(true);
    setTool('select');
  }

  function stopEditing() {
    if (!confirmDiscard()) return;
    if (dirty && mapQuery.data) setScene(normalizeScene(mapQuery.data.scene));
    setDirty(false);
    setPast([]);
    setFuture([]);
    setEditing(false);
    setTool('view');
    setSelectedElementId(null);
    setMeasure(null);
  }

  function switchMap(id: string) {
    if (id === mapId || !confirmDiscard()) return;
    setMapId(id);
    setPlacingId(null);
    setEditing(false);
    setTool('view');
  }

  async function createMap() {
    if (!confirmDiscard()) return;
    const name = window.prompt('Nom del mapa nou (planta, edifici, magatzem…)')?.trim();
    if (!name) return;
    try {
      const created = await mapsApi.create({ name });
      onChanged();
      setMapId(created.id);
      startEditing();
    } catch (reason) {
      setError(readError(reason));
    }
  }

  async function renameMap() {
    const current = state.maps.find((map) => map.id === mapId);
    const name = current ? window.prompt('Nom del mapa', current.name)?.trim() : null;
    if (!current || !name || name === current.name) return;
    try {
      await mapsApi.update(current.id, { name });
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    }
  }

  async function deleteMap() {
    const current = state.maps.find((map) => map.id === mapId);
    if (!current) return;
    const count = state.equipment.filter((item) => item.mapId === current.id && item.mapX !== null).length;
    if (!window.confirm(`Esborrar el mapa «${current.name}», el seu plànol i els fitxers importats?${count ? ` Els ${count} equips ubicats quedaran sense ubicar.` : ''} No es pot desfer.`)) return;
    try {
      await mapsApi.remove(current.id);
      setEditing(false);
      setTool('view');
      setDirty(false);
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    }
  }

  // ── Importació ──

  async function importFile(file: File) {
    if (!mapId) return;
    setError(null);
    const kind = fileKind(file.name);
    try {
      if (kind === 'dwg') throw new Error('Els DWG no es poden llegir directament: desa’l com a DXF (AutoCAD, LibreCAD o ODA File Converter, gratuït) i importa el DXF.');
      if (kind === 'unknown') throw new Error('Format no admès. Admesos: DXF, SVG, JSON (LanAtlas), GLB/GLTF, OBJ, STL, FBX, PLY, 3MF, DAE, PNG, JPG i WEBP.');
      if (kind === 'dxf' || kind === 'svg') {
        setBusy(`Llegint ${file.name}…`);
        const text = await file.text();
        const plan = kind === 'dxf' ? parseDxf(text, file.name) : await parseSvg(text, file.name);
        if (!plan.layers.length) throw new Error('El fitxer no té cap línia ni text que es pugui importar.');
        setRawPlan(plan);
        return;
      }
      if (kind === 'scene') {
        const parsed = normalizeScene(JSON.parse(await file.text()));
        if (scene.elements.length && !window.confirm(`Substituir el plànol actual (${scene.elements.length} elements) pel del fitxer (${parsed.elements.length})?`)) return;
        // Els fitxers (models i imatges) d'un altre mapa no hi són: es treuen.
        const assets = new Set((mapQuery.data?.assets ?? []).map((asset) => asset.id));
        const missing = parsed.elements.filter((element) => (element.kind === 'model' || element.kind === 'image') && !assets.has(element.assetId));
        commit({ ...parsed, elements: parsed.elements.filter((element) => !missing.includes(element)) });
        if (missing.length) setError(`${missing.length} models o imatges del fitxer no són en aquest mapa i no s’han importat: torna’ls a importar.`);
        startEditing();
        setFitToken((token) => token + 1);
        return;
      }
      // Models 3D i imatges: es pugen al servidor.
      setBusy(`Pujant ${file.name}… 0%`);
      const asset = await mapsApi.uploadAsset(mapId, file, (fraction) => setBusy(`Pujant ${file.name}… ${Math.round(fraction * 100)}%`));
      void queryClient.invalidateQueries({ queryKey: ['map', mapId], refetchType: 'none' });
      const [x0, y0, x1, y1] = sceneBounds(scene);
      const cx = Math.round(((x0 + x1) / 2) * 100) / 100;
      const cy = Math.round(((y0 + y1) / 2) * 100) / 100;
      const layer = scene.layers[0]?.id ?? 'structure';
      let element: SceneElement;
      if (kind === 'image') {
        const ratio = await imageRatio(file);
        const width = Number(window.prompt('Amplada real de la imatge en metres (després es pot ajustar)', String(Math.round(Math.max(20, x1 - x0))))?.replace(',', '.')) || 50;
        element = { id: newId(), kind: 'image', layer, assetId: asset.id, fileName: asset.fileName, x: cx, y: cy, w: width, d: Math.round(width * ratio * 100) / 100, rotation: 0, opacity: 0.85 };
        commit({ ...scene, elements: [element, ...scene.elements] });
      } else {
        setBusy(`Carregant ${file.name}…`);
        const scale = await suggestScale(mapsApi.assetUrl(asset.id), asset.fileName);
        element = { id: newId(), kind: 'model', layer, assetId: asset.id, fileName: asset.fileName, x: cx, y: cy, z: 0, rotation: 0, scale, color: '#94a3b8' };
        commit({ ...scene, elements: [...scene.elements, element] });
      }
      startEditing();
      setSelectedElementId(element.id);
      setFitToken((token) => token + 1);
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setBusy(null);
    }
  }

  function exportScene() {
    const name = state.maps.find((map) => map.id === mapId)?.name ?? 'mapa';
    const blob = new Blob([JSON.stringify(scene, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^\w-]+/g, '_')}.lanatlas.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Equips ──

  async function place(point: PlacePoint) {
    if (!placing || !mapId) return;
    setSaving(true);
    setError(null);
    try {
      await equipmentApi.setLocation(placing.id, { mapId, mapX: point.x, mapY: point.y, mapCode: point.code });
      onSelect(placing.id);
      setPlacingId(null);
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function unplace(item: Equipment) {
    if (!window.confirm(`Treure «${item.name}» del mapa?`)) return;
    try {
      await equipmentApi.setLocation(item.id, { mapId: null, mapX: null, mapY: null, mapCode: null });
      onChanged();
    } catch (reason) {
      setError(readError(reason));
    }
  }

  const unplacedList = unplaced
    .filter((item) => !unplacedQuery.trim() || fold(`${item.name} ${item.number ?? ''} ${item.location ?? ''} ${types.get(item.typeId)?.name ?? ''}`).includes(fold(unplacedQuery.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const activeTool = TOOLS.find((item) => item.key === tool);
  const mapName = state.maps.find((map) => map.id === mapId)?.name;

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <select
              value={mapId ?? ''}
              onChange={(event) => switchMap(event.target.value)}
              className="h-9 max-w-[14rem] rounded-lg border border-ink-200 bg-white px-2 text-sm font-semibold text-ink-900"
              aria-label="Mapa"
            >
              {state.maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </select>
            <IconButton icon={Plus} label="Mapa nou" onClick={() => void createMap()} />
            {mapId ? <IconButton icon={Pencil} label="Canvia el nom del mapa" onClick={() => void renameMap()} /> : null}
            {mapId ? <IconButton icon={Trash2} label="Esborra el mapa" onClick={() => void deleteMap()} danger /> : null}
          </div>
          {!editing ? (
            <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ressalta equips al mapa…"
                className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              {search ? (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label="Esborra la cerca">
                  <X size={15} />
                </button>
              ) : null}
            </label>
          ) : null}
          <div className="inline-flex rounded-lg bg-ink-100 p-1">
            {(
              [
                ['3d', '3D', Box],
                ['top', 'Planta', MapIcon],
              ] as const
            ).map(([key, text, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={clsx('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-sm font-medium', view === key ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-600 hover:text-ink-900')}
              >
                <Icon size={14} /> {text}
              </button>
            ))}
          </div>
          <IconButton icon={Maximize2} label="Encabeix-ho tot" onClick={() => setFitToken((token) => token + 1)} />
          {!editing ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLayers((value) => !value)}
                aria-expanded={showLayers}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50"
              >
                <Layers size={15} /> Capes
              </button>
              {showLayers ? (
                <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-ink-200 bg-white p-2 shadow-lg">
                  {scene.layers.map((layer) => (
                    <label key={layer.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-800 hover:bg-ink-50">
                      <input
                        type="checkbox"
                        checked={layer.visible}
                        onChange={(event) =>
                          setScene((current) => ({ ...current, layers: current.layers.map((item) => (item.id === layer.id ? { ...item, visible: event.target.checked } : item)) }))
                        }
                        className="h-4 w-4 rounded border-ink-300"
                      />
                      <span className="truncate">{layer.name}</span>
                    </label>
                  ))}
                  <p className="px-2 pt-1 text-[11px] text-ink-400">Només en aquesta vista; per desar-ho, fes-ho a «Edita el plànol».</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {!editing ? (
            <span className="text-xs text-ink-500">
              {placed.length} ubicats · {unplaced.length} sense ubicar
              {highlight ? ` · ${highlight.size} coincideixen` : ''}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {selected && selected.mapX !== null && selected.mapId === mapId && !editing ? (
              <button type="button" onClick={() => setFocusToken((token) => token + 1)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50">
                <Crosshair size={15} /> Centra {selected.name}
              </button>
            ) : null}
            {mapId && !editing ? (
              <button type="button" onClick={startEditing} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                <Pencil size={15} /> Edita el plànol
              </button>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50/60 p-1.5">
            <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-white p-0.5 shadow-sm">
              {TOOLS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setTool(item.key);
                      setMeasure(null);
                    }}
                    title={item.hint}
                    aria-pressed={tool === item.key}
                    className={clsx('inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium', tool === item.key ? 'bg-brand-500 text-white' : 'text-ink-700 hover:bg-ink-100')}
                  >
                    <Icon size={15} /> <span className="hidden xl:inline">{item.label}</span>
                  </button>
                );
              })}
            </div>
            {tool === 'select' && selectedElement ? (
              <div className="inline-flex gap-0.5 rounded-lg bg-white p-0.5 shadow-sm">
                {(
                  [
                    ['translate', Move, 'Mou (G)'],
                    ['rotate', RotateCw, 'Gira (R)'],
                    ['scale', Expand, 'Escala (S)'],
                  ] as const
                ).map(([key, Icon, text]) => (
                  <button
                    key={key}
                    type="button"
                    title={text}
                    aria-label={text}
                    onClick={() => setTransformMode(key)}
                    aria-pressed={transformMode === key}
                    className={clsx('grid h-8 w-8 place-items-center rounded-md', transformMode === key ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100')}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            ) : null}
            <label className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2 text-xs text-ink-600 shadow-sm" title="Quadrícula d’ajust">
              <Grid3x3 size={13} />
              <select
                value={scene.grid ?? 0.5}
                onChange={(event) => {
                  setScene((current) => ({ ...current, grid: Number(event.target.value) }));
                  setDirty(true);
                }}
                className="bg-transparent text-xs outline-none"
              >
                {[0.05, 0.1, 0.25, 0.5, 1, 2, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} m
                  </option>
                ))}
              </select>
            </label>
            <IconButton icon={Undo2} label="Desfés (Ctrl+Z)" onClick={undo} disabled={!past.length} />
            <IconButton icon={Redo2} label="Refés (Ctrl+Y)" onClick={redo} disabled={!future.length} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-sm font-medium text-ink-700 shadow-sm hover:bg-ink-50 disabled:opacity-50"
              title="DXF, SVG, imatges (PNG, JPG, WEBP), models 3D (GLB, GLTF, OBJ, STL, FBX, PLY, 3MF, DAE) o un JSON exportat"
            >
              <FileUp size={15} /> Importa
            </button>
            <IconButton icon={Download} label="Exporta el plànol (JSON)" onClick={exportScene} />
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file);
              }}
            />
            <div className="ml-auto flex items-center gap-1.5">
              {dirty ? <span className="text-xs font-medium text-amber-700">Canvis sense desar</span> : null}
              <button type="button" onClick={stopEditing} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-ink-700 hover:bg-white">
                {dirty ? 'Descarta' : 'Surt'}
              </button>
              <button
                type="button"
                onClick={() => void saveScene()}
                disabled={!dirty || saving}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Desa
              </button>
            </div>
          </div>
        ) : null}

        <div className="relative h-[calc(100vh-13rem)] min-h-[24rem] overflow-hidden rounded-xl border border-ink-200 bg-ink-100 shadow-sm">
          {!mapId ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <p className="font-semibold text-ink-900">Encara no hi ha cap mapa</p>
                <button type="button" onClick={() => void createMap()} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
                  <Plus size={16} /> Crea’n un
                </button>
              </div>
            </div>
          ) : mapQuery.isLoading ? (
            <Loading text="Carregant el mapa…" />
          ) : (
            <Suspense fallback={<Loading text="Carregant el visor 3D…" />}>
              <MapSceneView
                key={mapId}
                scene={scene}
                markers={markers}
                selectedId={selectedId}
                highlight={highlight}
                view={view}
                focusToken={focusToken}
                fitToken={fitToken}
                tool={tool}
                transformMode={transformMode}
                selectedElementId={selectedElementId}
                assetUrl={mapsApi.assetUrl}
                onSelect={(id) => onSelect(id)}
                onPlace={place}
                onSelectElement={setSelectedElementId}
                onChangeElement={changeElement}
                onCreateElement={(element) => {
                  commit({ ...scene, elements: [...scene.elements, element] });
                  if (element.kind !== 'wall' && element.kind !== 'zone') {
                    setTool('select');
                    setSelectedElementId(element.id);
                  }
                }}
                onMeasure={setMeasure}
                onModelError={(message) => setError(message)}
              />
            </Suspense>
          )}

          {mapId && !editing && !scene.elements.length && !mapQuery.isLoading ? (
            <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center px-4">
              <div className="pointer-events-auto max-w-md rounded-xl bg-white/95 px-4 py-3 text-center text-sm text-ink-700 shadow">
                <p className="font-semibold text-ink-900">El mapa «{mapName}» és buit</p>
                <p className="mt-0.5">Importa un plànol (DXF, SVG, imatge o model 3D) o dibuixa’l tu: parets, zones i blocs.</p>
                <button type="button" onClick={startEditing} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white hover:bg-brand-600">
                  <Pencil size={14} /> Edita el plànol
                </button>
              </div>
            </div>
          ) : null}

          {placing ? (
            <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 bg-brand-600 px-3 py-2 text-sm text-white shadow">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
              <span className="min-w-0 flex-1">
                Fes clic on és <strong>{placing.name}</strong> a «{mapName}». Si cliques sobre un bloc amb codi, s’hi enganxa.
              </span>
              <button type="button" onClick={() => setPlacingId(null)} className="rounded-md bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25">
                Cancel·la (Esc)
              </button>
            </div>
          ) : editing && activeTool ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
              <span className="rounded-full bg-ink-900/80 px-3 py-1 text-xs text-white">
                {activeTool.hint}
                {tool === 'measure' && measure !== null ? ` · ${measure.toFixed(2)} m` : ''}
              </span>
            </div>
          ) : null}
          {busy ? (
            <div className="absolute inset-0 grid place-items-center bg-white/60">
              <span className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow">
                <Loader2 className="animate-spin" size={16} /> {busy}
              </span>
            </div>
          ) : null}
          {error ? (
            <p className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm text-danger shadow">
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Tanca">
                <X size={15} />
              </button>
            </p>
          ) : null}
          {!editing ? <MapLegend /> : null}
        </div>
      </div>

      <div className="lg:w-[24rem] lg:shrink-0">
        {editing ? (
          <div className="hidden h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm lg:block">
            <EditorPanel scene={scene} selected={selectedElement} onChange={changeElement} onChangeScene={commit} onSelect={setSelectedElementId} />
          </div>
        ) : selected ? (
          <div className="fixed inset-x-0 bottom-0 z-40 h-[75vh] p-2 lg:static lg:z-auto lg:h-[calc(100vh-8rem)] lg:p-0">
            <EquipmentPanel
              item={selected}
              state={state}
              onClose={() => onSelect(null)}
              onEdit={() => onEdit(selected)}
              onChanged={onChanged}
              mapActions={
                mapId ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPlacingId(selected.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600">
                      <MapPin size={14} /> {selected.mapX !== null ? 'Mou al mapa' : 'Ubica al mapa'}
                    </button>
                    {selected.mapX !== null ? (
                      <button type="button" onClick={() => unplace(selected)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50">
                        <MapPinOff size={14} /> Treu del mapa
                      </button>
                    ) : null}
                    {selected.mapId && selected.mapId !== mapId ? (
                      <button type="button" onClick={() => switchMap(selected.mapId!)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                        <MapIcon size={14} /> Obre el seu mapa
                      </button>
                    ) : null}
                  </div>
                ) : null
              }
            />
          </div>
        ) : (
          <div className="hidden h-[calc(100vh-8rem)] flex-col rounded-2xl border border-ink-200 bg-white shadow-sm lg:flex">
            <div className="border-b border-ink-100 px-4 py-3">
              <h2 className="font-semibold text-ink-900">Sense ubicar ({unplaced.length})</h2>
              <p className="text-xs text-ink-500">Tria un equip i fes clic al mapa on és. Clica una agulla del mapa per veure’n la fitxa.</p>
              <input
                value={unplacedQuery}
                onChange={(event) => setUnplacedQuery(event.target.value)}
                placeholder="Filtra…"
                className="mt-2 h-8 w-full rounded-lg border border-ink-200 px-2 text-sm outline-none focus:border-brand-400"
              />
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-ink-100 overflow-auto">
              {unplacedList.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(item.id);
                      if (mapId) setPlacingId(item.id);
                    }}
                    className={clsx('flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-brand-50', placingId === item.id && 'bg-brand-50')}
                  >
                    <TypeIcon type={types.get(item.typeId)} size={12} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{item.name}</span>
                      <span className="block truncate text-xs text-ink-500">{item.location ?? types.get(item.typeId)?.name}</span>
                    </span>
                    <NetDot state={item.netState} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rawPlan ? (
        <ImportDialog
          plan={rawPlan}
          base={scene}
          onClose={() => setRawPlan(null)}
          onApply={(next) => {
            setRawPlan(null);
            commit(next);
            startEditing();
            setSelectedElementId(null);
            setFitToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function IconButton({ icon: Icon, label, onClick, disabled, danger }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={clsx(
        'grid h-8 w-8 place-items-center rounded-lg bg-white text-ink-600 shadow-sm ring-1 ring-ink-200 hover:bg-ink-50 disabled:opacity-40',
        danger ? 'hover:text-danger' : 'hover:text-ink-900',
      )}
    >
      <Icon size={15} />
    </button>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center text-ink-500">
      <span className="inline-flex items-center gap-2 text-sm">
        <Loader2 className="animate-spin" size={18} /> {text}
      </span>
    </div>
  );
}

function MapLegend() {
  const items = [
    ['bg-emerald-500', 'Respon'],
    ['bg-red-500', 'No respon'],
    ['bg-amber-400', 'Comprovant'],
    ['bg-slate-400', 'Sense proves'],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/90 px-3 py-1.5 text-xs text-ink-700 shadow-sm">
      {items.map(([dot, text]) => (
        <span key={text} className="inline-flex items-center gap-1.5">
          <span className={clsx('h-2.5 w-2.5 rounded-full', dot)} /> {text}
        </span>
      ))}
    </div>
  );
}

/** Alt / ample d'una imatge (per estendre-la a terra amb la proporció bona). */
function imageRatio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve(image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(1);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/** Escala inicial d'un model: si fa més de 3000 unitats segurament és en mm; si en fa més de 300, en cm. */
async function suggestScale(url: string, fileName: string): Promise<number> {
  try {
    const { loadModel, modelSize } = await import('./map/loaders');
    const size = modelSize(await loadModel(url, fileName, '#94a3b8'));
    const largest = Math.max(size.x, size.y, size.z);
    if (largest > 3000) return 0.001;
    if (largest > 300) return 0.01;
    return 1;
  } catch {
    return 1;
  }
}
