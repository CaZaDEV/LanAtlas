/**
 * Escena editable d'un mapa (es desa com a JSON a MapPlan.scene).
 *
 * Coordenades en metres sobre el pla: «x» cap a la dreta i «y» cap avall (com en un plànol). Al món 3D, x → X,
 * y → Z i l'alçada és Y. Els equips es desen amb el mateix sistema (mapX, mapY).
 */

export type ElementKind = 'wall' | 'box' | 'zone' | 'lines' | 'label' | 'model' | 'image';

interface BaseElement {
  id: string;
  kind: ElementKind;
  layer: string;
  /** Text visible al mapa (opcional). */
  label?: string | null;
  /** Codi on es pot «enganxar» un equip en ubicar-lo («049A», «RACK-3»). */
  code?: string | null;
  locked?: boolean;
}

/** Parets: una o més polilínies aixecades. Les importades d'un plànol van totes en un element per capa. */
export interface WallElement extends BaseElement {
  kind: 'wall';
  /** Polilínies [x0, y0, x1, y1, …]. */
  paths: number[][];
  height: number;
  color: string;
  opacity: number;
}

/** Bloc: estanteria, màquina, moble… Centre (x, y), mida (w × d × h) i gir en graus. */
export interface BoxElement extends BaseElement {
  kind: 'box';
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  rotation: number;
  color: string;
  opacity: number;
  /** Contorn real a terra (si ve d'un plànol), relatiu al centre i sense girar. */
  outline?: number[][];
}

/** Zona pintada a terra (sala, passadís, àrea de treball). */
export interface ZoneElement extends BaseElement {
  kind: 'zone';
  points: number[];
  color: string;
  opacity: number;
}

/** Línies de dibuix (passadissos, mobiliari, detalls d'un CAD) a terra. */
export interface LinesElement extends BaseElement {
  kind: 'lines';
  paths: number[][];
  color: string;
}

export interface LabelElement extends BaseElement {
  kind: 'label';
  x: number;
  y: number;
  text: string;
  /** small = nota petita, normal = nom de sala. */
  size: 'small' | 'normal';
}

/** Model 3D importat (GLB, OBJ, STL, FBX…), desat com a fitxer del mapa. */
export interface ModelElement extends BaseElement {
  kind: 'model';
  assetId: string;
  fileName: string;
  x: number;
  y: number;
  /** Alçada sobre el terra. */
  z: number;
  rotation: number;
  scale: number;
  /** Color per als formats sense material (STL, PLY). */
  color: string;
}

/** Imatge (plànol escanejat, foto aèria) estesa a terra. */
export interface ImageElement extends BaseElement {
  kind: 'image';
  assetId: string;
  fileName: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
  opacity: number;
}

export type SceneElement = WallElement | BoxElement | ZoneElement | LinesElement | LabelElement | ModelElement | ImageElement;

export interface SceneLayer {
  id: string;
  name: string;
  visible: boolean;
}

export interface MapScene {
  version: 1;
  units: 'm';
  layers: SceneLayer[];
  elements: SceneElement[];
  /** Mida de la quadrícula d'ajust (m). */
  grid?: number;
}

export const KIND_LABEL: Record<ElementKind, string> = {
  wall: 'Paret',
  box: 'Bloc',
  zone: 'Zona',
  lines: 'Línies',
  label: 'Text',
  model: 'Model 3D',
  image: 'Imatge',
};

export const DEFAULT_LAYERS: SceneLayer[] = [
  { id: 'structure', name: 'Estructura', visible: true },
  { id: 'furniture', name: 'Mobiliari i màquines', visible: true },
  { id: 'labels', name: 'Etiquetes', visible: true },
];

export function newId(prefix = 'el'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

/** Escena vàlida a partir del JSON desat (tolerant amb dades antigues o incompletes). */
export function normalizeScene(input: unknown): MapScene {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<MapScene>;
  const layers = Array.isArray(raw.layers) && raw.layers.length ? raw.layers.filter((layer) => layer && typeof layer.id === 'string') : DEFAULT_LAYERS;
  const ids = new Set(layers.map((layer) => layer.id));
  const elements = (Array.isArray(raw.elements) ? raw.elements : []).filter((element) => element && typeof element.id === 'string' && typeof element.kind === 'string');
  for (const element of elements) if (!ids.has(element.layer)) element.layer = layers[0].id;
  return { version: 1, units: 'm', layers, elements, grid: typeof raw.grid === 'number' && raw.grid > 0 ? raw.grid : 0.5 };
}

export function emptyScene(): MapScene {
  return { version: 1, units: 'm', layers: DEFAULT_LAYERS.map((layer) => ({ ...layer })), elements: [], grid: 0.5 };
}

// ── Geometria ───────────────────────────────────────────────────────────────

export type Bounds = [number, number, number, number];

function extend(bounds: Bounds, x: number, y: number) {
  if (x < bounds[0]) bounds[0] = x;
  if (y < bounds[1]) bounds[1] = y;
  if (x > bounds[2]) bounds[2] = x;
  if (y > bounds[3]) bounds[3] = y;
}

/** Caixa de l'escena (m). Sense res, una àrea de 40 × 30 m. */
export function sceneBounds(scene: MapScene, extra: { x: number; y: number }[] = []): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const element of scene.elements) {
    switch (element.kind) {
      case 'wall':
      case 'lines':
        for (const path of element.paths) for (let i = 0; i + 1 < path.length; i += 2) extend(bounds, path[i], path[i + 1]);
        break;
      case 'zone':
        for (let i = 0; i + 1 < element.points.length; i += 2) extend(bounds, element.points[i], element.points[i + 1]);
        break;
      case 'box':
      case 'image': {
        const r = Math.hypot(element.w, element.d) / 2;
        extend(bounds, element.x - r, element.y - r);
        extend(bounds, element.x + r, element.y + r);
        break;
      }
      default:
        extend(bounds, element.x, element.y);
    }
  }
  for (const point of extra) extend(bounds, point.x, point.y);
  if (!Number.isFinite(bounds[0])) return [0, 0, 40, 30];
  if (bounds[2] - bounds[0] < 5) bounds[2] = bounds[0] + 5;
  if (bounds[3] - bounds[1] < 5) bounds[3] = bounds[1] + 5;
  return bounds;
}

/** Element amb codi on cau un punt (dins del bloc) o el més proper a menys de `radius` m. */
export function nearestCode(scene: MapScene, x: number, y: number, radius = 1.5): { code: string; x: number; y: number } | null {
  let best: { code: string; x: number; y: number } | null = null;
  let distance = radius;
  const hidden = new Set(scene.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  for (const element of scene.elements) {
    if (!element.code || hidden.has(element.layer)) continue;
    if (element.kind === 'box') {
      const angle = (-element.rotation * Math.PI) / 180;
      const dx = x - element.x;
      const dy = y - element.y;
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (Math.abs(lx) <= element.w / 2 && Math.abs(ly) <= element.d / 2) return { code: element.code, x: element.x, y: element.y };
    }
    if ('x' in element && 'y' in element) {
      const d = Math.hypot(element.x - x, element.y - y);
      if (d <= distance) {
        best = { code: element.code, x: element.x, y: element.y };
        distance = d;
      }
    }
  }
  return best;
}

/** Mou un element `dx`, `dy` metres. */
export function translateElement<T extends SceneElement>(element: T, dx: number, dy: number): T {
  const shift = (list: number[]) => list.map((value, index) => Math.round((value + (index % 2 === 0 ? dx : dy)) * 1000) / 1000);
  switch (element.kind) {
    case 'wall':
    case 'lines':
      return { ...element, paths: element.paths.map(shift) };
    case 'zone':
      return { ...element, points: shift(element.points) };
    default:
      return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
  }
}

/** Centre aproximat d'un element (per a les eines de moure). */
export function elementCenter(element: SceneElement): { x: number; y: number } {
  if (element.kind === 'wall' || element.kind === 'lines' || element.kind === 'zone') {
    const bounds = sceneBounds({ version: 1, units: 'm', layers: [], elements: [element] });
    return { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 };
  }
  return { x: element.x, y: element.y };
}

export function round(value: number, step = 0.001): number {
  return Math.round(value / step) * step;
}

export function snap(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}

/** Nombre de vèrtexs (per avisar si l'escena és massa pesada). */
export function sceneWeight(scene: MapScene): number {
  let total = 0;
  for (const element of scene.elements) {
    if (element.kind === 'wall' || element.kind === 'lines') total += element.paths.reduce((sum, path) => sum + path.length / 2, 0);
    else if (element.kind === 'zone') total += element.points.length / 2;
    else total += 8;
  }
  return total;
}
