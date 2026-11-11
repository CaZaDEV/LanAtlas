import DxfParser from 'dxf-parser';

import {
  newId,
  type BoxElement,
  type LabelElement,
  type LinesElement,
  type MapScene,
  type SceneElement,
  type SceneLayer,
  type WallElement,
  type ZoneElement,
} from './scene';

/**
 * Importació de plànols 2D (DXF de CAD i SVG) a elements editables de l'escena. Primer es llegeix el fitxer a
 * capes «crues» (polilínies i textos en unitats del fitxer); després, al diàleg, es tria què és cada capa
 * (parets, blocs, zones, línies, textos o res) i l'escala, i es generen els elements.
 */

export interface RawLayer {
  name: string;
  paths: number[][];
  /** Mateixa llargada que `paths`: si la polilínia és tancada. */
  closed: boolean[];
  texts: { text: string; x: number; y: number; height: number }[];
}

export interface RawPlan {
  source: string;
  /** Metres per unitat del fitxer, si el fitxer ho diu. */
  metersPerUnit: number | null;
  layers: RawLayer[];
}

export type LayerRole = 'walls' | 'boxes' | 'zones' | 'lines' | 'labels' | 'ignore';

export const ROLE_LABEL: Record<LayerRole, string> = {
  walls: 'Parets',
  boxes: 'Blocs (estanteries, màquines…)',
  zones: 'Zones a terra',
  lines: 'Línies a terra',
  labels: 'Només els textos',
  ignore: 'No importar',
};

export interface ImportOptions {
  metersPerUnit: number;
  roles: Record<string, LayerRole>;
  wallHeight: number;
  boxHeight: number;
  /** Els textos que cauen dins d'un bloc passen a ser el seu codi (per enganxar-hi equips). */
  textsAsCodes: boolean;
  /** Afegir a l'escena (true) o substituir-la. */
  append: boolean;
}

// ── DXF ───────────────────────────────────────────────────────────────────────

/** $INSUNITS → metres per unitat. */
const INSUNITS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

interface DxfPoint {
  x: number;
  y: number;
  bulge?: number;
}

interface DxfEntity {
  type: string;
  layer?: string;
  vertices?: DxfPoint[];
  shape?: boolean;
  closed?: boolean;
  center?: DxfPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  majorAxisEndPoint?: DxfPoint;
  axisRatio?: number;
  controlPoints?: DxfPoint[];
  fitPoints?: DxfPoint[];
  startPoint?: DxfPoint;
  position?: DxfPoint;
  text?: string;
  textHeight?: number;
  height?: number;
  name?: string;
  xScale?: number;
  yScale?: number;
  rotation?: number;
}

interface DxfData {
  header?: Record<string, unknown>;
  entities: DxfEntity[];
  blocks?: Record<string, { entities?: DxfEntity[]; position?: DxfPoint }>;
}

type Transform = (p: DxfPoint) => DxfPoint;

const identity: Transform = (p) => p;

/** Arcs de les polilínies («bulge») convertits en segments. */
function bulgePoints(a: DxfPoint, b: DxfPoint, bulge: number): DxfPoint[] {
  const angle = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!chord || Math.abs(bulge) < 1e-6) return [];
  const radius = chord / (2 * Math.sin(angle / 2));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const sagittaDistance = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2)) * Math.sign(bulge) * Math.sign(radius);
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  const center = { x: mid.x - nx * sagittaDistance, y: mid.y - ny * sagittaDistance };
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const steps = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 16)));
  const out: DxfPoint[] = [];
  for (let i = 1; i < steps; i += 1) {
    const t = start + (angle * i) / steps;
    out.push({ x: center.x + Math.abs(radius) * Math.cos(t), y: center.y + Math.abs(radius) * Math.sin(t) });
  }
  return out;
}

function arcPoints(center: DxfPoint, radius: number, start: number, end: number): DxfPoint[] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 24)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = start + (sweep * i) / steps;
    return { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) };
  });
}

export function parseDxf(text: string, source: string): RawPlan {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text) as unknown as DxfData | null;
  if (!dxf) throw new Error('No s’ha pogut llegir el DXF');
  const units = Number((dxf.header ?? {})['$INSUNITS']);
  const layers = new Map<string, RawLayer>();
  const layerOf = (name: string) => {
    let layer = layers.get(name);
    if (!layer) {
      layer = { name, paths: [], closed: [], texts: [] };
      layers.set(name, layer);
    }
    return layer;
  };
  const push = (layerName: string, points: DxfPoint[], closed: boolean, transform: Transform) => {
    if (points.length < 2) return;
    const flat: number[] = [];
    for (const point of points) {
      const p = transform(point);
      // DXF: «y» cap amunt; el pla: cap avall.
      flat.push(p.x, -p.y);
    }
    if (closed) flat.push(flat[0], flat[1]);
    const layer = layerOf(layerName);
    layer.paths.push(flat);
    layer.closed.push(closed);
  };

  const walk = (entities: DxfEntity[], transform: Transform, parentLayer: string | null, depth: number) => {
    for (const entity of entities) {
      const layerName = entity.layer && !(entity.layer === '0' && parentLayer) ? entity.layer : parentLayer ?? '0';
      switch (entity.type) {
        case 'LINE':
          push(layerName, entity.vertices ?? [], false, transform);
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const vertices = entity.vertices ?? [];
          const closed = !!(entity.shape || entity.closed);
          const points: DxfPoint[] = [];
          vertices.forEach((vertex, index) => {
            points.push(vertex);
            const next = vertices[index + 1] ?? (closed ? vertices[0] : null);
            if (next && vertex.bulge) points.push(...bulgePoints(vertex, next, vertex.bulge));
          });
          push(layerName, points, closed, transform);
          break;
        }
        case 'CIRCLE':
          if (entity.center && entity.radius) push(layerName, arcPoints(entity.center, entity.radius, 0, Math.PI * 2), false, transform);
          break;
        case 'ARC':
          if (entity.center && entity.radius) push(layerName, arcPoints(entity.center, entity.radius, entity.startAngle ?? 0, entity.endAngle ?? Math.PI * 2), false, transform);
          break;
        case 'ELLIPSE': {
          const { center, majorAxisEndPoint: axis } = entity;
          if (!center || !axis) break;
          const major = Math.hypot(axis.x, axis.y);
          const minor = major * (entity.axisRatio ?? 1);
          const rotation = Math.atan2(axis.y, axis.x);
          const start = entity.startAngle ?? 0;
          let end = entity.endAngle ?? Math.PI * 2;
          if (end <= start) end += Math.PI * 2;
          const steps = 48;
          const points = Array.from({ length: steps + 1 }, (_, i) => {
            const t = start + ((end - start) * i) / steps;
            const x = major * Math.cos(t);
            const y = minor * Math.sin(t);
            return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) };
          });
          push(layerName, points, false, transform);
          break;
        }
        case 'SPLINE':
          push(layerName, entity.fitPoints?.length ? entity.fitPoints : entity.controlPoints ?? [], !!entity.closed, transform);
          break;
        case 'SOLID':
        case '3DFACE':
          push(layerName, entity.vertices ?? [], true, transform);
          break;
        case 'TEXT':
        case 'MTEXT': {
          const at = entity.startPoint ?? entity.position;
          const value = cleanMtext(entity.text ?? '');
          if (at && value) {
            const p = transform(at);
            layerOf(layerName).texts.push({ text: value, x: p.x, y: -p.y, height: entity.textHeight ?? entity.height ?? 0 });
          }
          break;
        }
        case 'INSERT': {
          const block = entity.name ? dxf.blocks?.[entity.name] : undefined;
          if (!block?.entities?.length || depth > 6) break;
          const base = block.position ?? { x: 0, y: 0 };
          const sx = entity.xScale ?? 1;
          const sy = entity.yScale ?? 1;
          const angle = ((entity.rotation ?? 0) * Math.PI) / 180;
          const at = entity.position ?? { x: 0, y: 0 };
          const local: Transform = (p) => {
            const x = (p.x - base.x) * sx;
            const y = (p.y - base.y) * sy;
            return transform({ x: at.x + x * Math.cos(angle) - y * Math.sin(angle), y: at.y + x * Math.sin(angle) + y * Math.cos(angle) });
          };
          walk(block.entities, local, layerName, depth + 1);
          break;
        }
        default:
          break;
      }
    }
  };
  walk(dxf.entities ?? [], identity, null, 0);
  return { source, metersPerUnit: INSUNITS[units] ?? null, layers: sortLayers([...layers.values()]) };
}

/** Treu els codis de format de MTEXT («\P», «{\fArial;…}»). */
function cleanMtext(text: string): string {
  return text
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/%%[cdp]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SVG ───────────────────────────────────────────────────────────────────────

/** SVG: una capa per grup de primer nivell amb id/etiqueta (Inkscape, Illustrator) o per color de traç. */
export async function parseSvg(text: string, source: string): Promise<RawPlan> {
  const { SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js');
  const data = new SVGLoader().parse(text);
  const layers = new Map<string, RawLayer>();
  for (const path of data.paths) {
    const node = path.userData?.node as Element | undefined;
    let group: Element | null = node?.parentElement ?? null;
    let name: string | null = null;
    while (group && group.tagName.toLowerCase() !== 'svg') {
      name = group.getAttribute('inkscape:label') ?? group.getAttribute('id') ?? name;
      group = group.parentElement;
    }
    const stroke = (path.userData?.style as { stroke?: string } | undefined)?.stroke;
    const layerName = name ?? (stroke && stroke !== 'none' ? `Traç ${stroke}` : 'SVG');
    let layer = layers.get(layerName);
    if (!layer) {
      layer = { name: layerName, paths: [], closed: [], texts: [] };
      layers.set(layerName, layer);
    }
    for (const sub of path.subPaths) {
      const points = sub.getPoints();
      if (points.length < 2) continue;
      const first = points[0];
      const last = points[points.length - 1];
      const closed = sub.autoClose || (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6);
      const flat = points.flatMap((point) => [point.x, point.y]);
      if (sub.autoClose) flat.push(first.x, first.y);
      layer.paths.push(flat);
      layer.closed.push(closed);
    }
  }
  // Textos (no els llegeix SVGLoader).
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  doc.querySelectorAll('text').forEach((node) => {
    const value = node.textContent?.trim();
    const x = Number(node.getAttribute('x') ?? node.querySelector('tspan')?.getAttribute('x') ?? NaN);
    const y = Number(node.getAttribute('y') ?? node.querySelector('tspan')?.getAttribute('y') ?? NaN);
    if (!value || !Number.isFinite(x) || !Number.isFinite(y)) return;
    let layer = layers.get('Textos');
    if (!layer) {
      layer = { name: 'Textos', paths: [], closed: [], texts: [] };
      layers.set('Textos', layer);
    }
    layer.texts.push({ text: value, x, y, height: Number(node.getAttribute('font-size')) || 0 });
  });
  return { source, metersPerUnit: null, layers: sortLayers([...layers.values()]) };
}

function sortLayers(list: RawLayer[]): RawLayer[] {
  return list.filter((layer) => layer.paths.length || layer.texts.length).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ── Rols per defecte i conversió ──────────────────────────────────────────────

/** Rol probable d'una capa pel nom (català, castellà i anglès) i pel contingut. */
export function guessRole(layer: RawLayer): LayerRole {
  const name = layer.name.toLowerCase();
  if (!layer.paths.length) return layer.texts.length ? 'labels' : 'ignore';
  if (/mur|wall|pared|paret|tabique|envolvent|fachada|fa[cç]ana|structure|estructura|pilar|column/.test(name)) return 'walls';
  if (/rack|estant|estanter|shelf|shelv|palet|prestat/.test(name)) return 'boxes';
  if (/maquin|màquin|machine|equip|mobili|furniture|mueble|moble/.test(name)) return 'boxes';
  if (/cota|dim|hatch|trama|axis|eix|eje|grid|defpoint|viewport/.test(name)) return 'ignore';
  if (/zona|area|àrea|room|sala|space|espai/.test(name)) return 'zones';
  return 'lines';
}

/** Mida del plànol en unitats del fitxer (per proposar l'escala quan el fitxer no la diu). */
export function rawExtent(plan: RawPlan, roles?: Record<string, LayerRole>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of plan.layers) {
    if (roles && roles[layer.name] === 'ignore') continue;
    for (const path of layer.paths) {
      for (let i = 0; i + 1 < path.length; i += 2) {
        if (path[i] < minX) minX = path[i];
        if (path[i] > maxX) maxX = path[i];
        if (path[i + 1] < minY) minY = path[i + 1];
        if (path[i + 1] > maxY) maxY = path[i + 1];
      }
    }
    for (const text of layer.texts) {
      if (text.x < minX) minX = text.x;
      if (text.x > maxX) maxX = text.x;
      if (text.y < minY) minY = text.y;
      if (text.y > maxY) maxY = text.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Escala proposada quan el fitxer no en diu: suposa que el dibuix fa entre 10 m i 500 m. */
export function guessMetersPerUnit(plan: RawPlan): number {
  if (plan.metersPerUnit) return plan.metersPerUnit;
  const extent = rawExtent(plan);
  const size = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  for (const candidate of [1, 0.01, 0.001]) {
    const meters = size * candidate;
    if (meters >= 5 && meters <= 800) return candidate;
  }
  return size > 0 ? 50 / size : 1;
}

const LAYER_COLORS = ['#2563eb', '#b45309', '#16a34a', '#7c3aed', '#0e7490', '#be123c', '#475569'];

/** Converteix el plànol cru en capes i elements de l'escena, a partir de (0, 0). */
export function rawToScene(plan: RawPlan, options: ImportOptions, base: MapScene): MapScene {
  const extent = rawExtent(plan, options.roles);
  const k = options.metersPerUnit;
  // A continuació de l'escena actual si s'hi afegeix; si no, a l'origen.
  const offsetX = -extent.minX * k;
  const offsetY = -extent.minY * k;
  const tx = (value: number) => Math.round((value * k + offsetX) * 1000) / 1000;
  const ty = (value: number) => Math.round((value * k + offsetY) * 1000) / 1000;
  const toMeters = (path: number[]) => path.map((value, index) => (index % 2 === 0 ? tx(value) : ty(value)));

  const layers: SceneLayer[] = options.append ? base.layers.map((layer) => ({ ...layer })) : [];
  const elements: SceneElement[] = options.append ? [...base.elements] : [];
  const boxes: BoxElement[] = [];
  const texts: { text: string; x: number; y: number; layer: string }[] = [];

  plan.layers.forEach((raw, index) => {
    const role = options.roles[raw.name] ?? 'ignore';
    if (role === 'ignore') return;
    const layerId = newId('layer');
    layers.push({ id: layerId, name: `${raw.name}`, visible: true });
    const color = LAYER_COLORS[index % LAYER_COLORS.length];
    const paths = raw.paths.map(toMeters);
    if (role === 'walls' && paths.length) {
      elements.push({ id: newId(), kind: 'wall', layer: layerId, paths, height: options.wallHeight, color: '#cbd5e1', opacity: 0.4 } satisfies WallElement);
    } else if (role === 'lines' && paths.length) {
      elements.push({ id: newId(), kind: 'lines', layer: layerId, paths, color } satisfies LinesElement);
    } else if (role === 'zones') {
      paths.forEach((points, i) => {
        if (raw.closed[i] && points.length >= 6) elements.push({ id: newId(), kind: 'zone', layer: layerId, points, color, opacity: 0.18 } satisfies ZoneElement);
      });
      const open = paths.filter((_, i) => !raw.closed[i]);
      if (open.length) elements.push({ id: newId(), kind: 'lines', layer: layerId, paths: open, color } satisfies LinesElement);
    } else if (role === 'boxes') {
      const open: number[][] = [];
      paths.forEach((points, i) => {
        const box = raw.closed[i] ? boxFromPolygon(points, layerId, options.boxHeight, color) : null;
        if (box) boxes.push(box);
        else open.push(points);
      });
      if (open.length) elements.push({ id: newId(), kind: 'lines', layer: layerId, paths: open, color } satisfies LinesElement);
    }
    for (const text of raw.texts) texts.push({ text: text.text, x: tx(text.x), y: ty(text.y), layer: layerId });
  });

  // Textos dins d'un bloc → codi del bloc; la resta, etiquetes.
  const used = new Set<number>();
  if (options.textsAsCodes) {
    texts.forEach((text, index) => {
      const short = text.text.length <= 24 && /^[0-9A-Za-z._-]+$/.test(text.text);
      if (!short) return;
      const box = boxes.find((item) => !item.code && Math.abs(text.x - item.x) <= item.w / 2 && Math.abs(text.y - item.y) <= item.d / 2);
      if (box) {
        box.code = text.text.toUpperCase();
        box.label = text.text;
        used.add(index);
      }
    });
  }
  elements.push(...boxes);
  texts.forEach((text, index) => {
    if (used.has(index)) return;
    elements.push({ id: newId(), kind: 'label', layer: text.layer, x: text.x, y: text.y, text: text.text.slice(0, 120), size: text.text.length > 18 ? 'small' : 'normal' } satisfies LabelElement);
  });

  if (!layers.length) layers.push({ id: 'structure', name: 'Estructura', visible: true });
  return { ...base, version: 1, units: 'm', layers, elements };
}

/** Polígon tancat → bloc: rectangle girat si té 4 costats, si no la caixa que l'envolta (amb el contorn real). */
function boxFromPolygon(points: number[], layer: string, height: number, color: string): BoxElement | null {
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) vertices.push({ x: points[i], y: points[i + 1] });
  if (vertices.length > 1) {
    const a = vertices[0];
    const b = vertices[vertices.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) vertices.pop();
  }
  if (vertices.length < 3) return null;
  // Gir: el del costat més llarg (els rectangles girats queden ben ajustats).
  let angle = 0;
  let longest = 0;
  vertices.forEach((point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(next.y - point.y, next.x - point.x);
    }
  });
  if (vertices.length !== 4) angle = 0;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const local = vertices.map((point) => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }));
  const minX = Math.min(...local.map((p) => p.x));
  const maxX = Math.max(...local.map((p) => p.x));
  const minY = Math.min(...local.map((p) => p.y));
  const maxY = Math.max(...local.map((p) => p.y));
  const w = maxX - minX;
  const d = maxY - minY;
  if (w < 0.05 || d < 0.05) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const center = { x: cx * Math.cos(angle) - cy * Math.sin(angle), y: cx * Math.sin(angle) + cy * Math.cos(angle) };
  const outline = vertices.length !== 4 ? [local.flatMap((p) => [round3(p.x - cx), round3(p.y - cy)])] : undefined;
  return {
    id: newId(),
    kind: 'box',
    layer,
    x: round3(center.x),
    y: round3(center.y),
    w: round3(w),
    d: round3(d),
    h: w * d > 60 ? 0.05 : height,
    rotation: round3((angle * 180) / Math.PI),
    color,
    opacity: 0.25,
    outline,
  };
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

// ── Tipus de fitxer ───────────────────────────────────────────────────────────

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', '3mf', 'dae'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
export const ACCEPT = ['.dxf', '.svg', '.json', ...MODEL_EXTENSIONS.map((ext) => `.${ext}`), ...IMAGE_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

export type FileKind = 'dxf' | 'svg' | 'scene' | 'model' | 'image' | 'dwg' | 'unknown';

export function fileKind(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'svg') return 'svg';
  if (ext === 'json') return 'scene';
  if (ext === 'dwg') return 'dwg';
  if (MODEL_EXTENSIONS.includes(ext)) return 'model';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'unknown';
}
