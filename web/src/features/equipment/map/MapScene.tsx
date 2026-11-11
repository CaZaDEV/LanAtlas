import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import type { NetState } from '@/api/equipment';
import { groundModel, loadModel } from './loaders';
import {
  elementCenter,
  nearestCode,
  newId,
  round,
  sceneBounds,
  snap,
  translateElement,
  type BoxElement,
  type LabelElement,
  type MapScene,
  type SceneElement,
  type WallElement,
  type ZoneElement,
} from './scene';
import './map.css';

/**
 * Escena 3D d'un mapa (three.js): visor amb els equips com a agulles de color segons l'estat de la xarxa i editor
 * del plànol (dibuixar parets, zones, blocs i textos; moure, girar i escalar amb manetes; mesurar). Es carrega
 * sota demanda (pestanya Mapa).
 */

export interface SceneMarker {
  id: string;
  name: string;
  x: number;
  y: number;
  state: NetState;
  critical: boolean;
}

export interface PlacePoint {
  x: number;
  y: number;
  code: string | null;
}

export type Tool = 'view' | 'place' | 'select' | 'wall' | 'zone' | 'box' | 'label' | 'measure';
export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface MapSceneProps {
  scene: MapScene;
  markers: SceneMarker[];
  selectedId: string | null;
  /** Ids que coincideixen amb la cerca (null = sense cerca). */
  highlight: Set<string> | null;
  view: '3d' | 'top';
  /** Canvia per centrar la càmera en l'equip seleccionat. */
  focusToken: number;
  /** Canvia per encabir tota l'escena a la vista. */
  fitToken: number;
  tool: Tool;
  transformMode: TransformMode;
  selectedElementId: string | null;
  assetUrl: (assetId: string) => string;
  onSelect: (id: string | null) => void;
  onPlace: (point: PlacePoint) => void;
  onSelectElement: (id: string | null) => void;
  onChangeElement: (element: SceneElement) => void;
  onCreateElement: (element: SceneElement) => void;
  onMeasure: (meters: number | null) => void;
  onModelError: (message: string) => void;
}

const STATE_COLOR: Record<NetState, number> = { UP: 0x10b981, DOWN: 0xef4444, UNKNOWN: 0xf59e0b, NONE: 0x94a3b8 };
const DRAW_COLOR = 0x0e7c86;

function label(text: string, className: string): CSS2DObject {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return new CSS2DObject(element);
}

function color(value: string | undefined, fallback = '#64748b') {
  return new THREE.Color(value || fallback);
}

/** Segments d'unes polilínies (relatius a `cx`, `cz`). */
function segmentPositions(paths: number[][], y: number, cx: number, cz: number): Float32Array {
  let count = 0;
  for (const path of paths) count += Math.max(0, path.length / 2 - 1);
  const out = new Float32Array(count * 6);
  let o = 0;
  for (const path of paths) {
    for (let i = 0; i + 3 < path.length; i += 2) {
      out[o++] = path[i] - cx;
      out[o++] = y;
      out[o++] = path[i + 1] - cz;
      out[o++] = path[i + 2] - cx;
      out[o++] = y;
      out[o++] = path[i + 3] - cz;
    }
  }
  return out;
}

function lineMesh(paths: number[][], y: number, lineColor: THREE.Color, cx: number, cz: number, opacity = 1): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(segmentPositions(paths, y, cx, cz), 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: lineColor, transparent: opacity < 1, opacity }));
}

/** Construeix l'objecte 3D d'un element. El grup queda a l'«àncora» de l'element (centre) perquè girar-lo sigui natural. */
function buildElement(element: SceneElement, assetUrl: (id: string) => string, onModelError: (message: string) => void): THREE.Object3D {
  const group = new THREE.Group();
  group.userData.elementId = element.id;
  switch (element.kind) {
    case 'wall': {
      const { x: cx, y: cz } = elementCenter(element);
      const flat = segmentPositions(element.paths, 0, cx, cz);
      const positions = new Float32Array((flat.length / 6) * 18);
      let o = 0;
      for (let i = 0; i < flat.length; i += 6) {
        const [ax, , az, bx, , bz] = flat.subarray(i, i + 6);
        positions.set([ax, 0, az, bx, 0, bz, bx, element.height, bz, ax, 0, az, bx, element.height, bz, ax, element.height, az], o);
        o += 18;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const wallColor = color(element.color, '#cbd5e1');
      group.add(
        new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: wallColor, transparent: element.opacity < 1, opacity: element.opacity, side: THREE.DoubleSide, depthWrite: element.opacity >= 1 })),
        lineMesh(element.paths, 0.02, new THREE.Color(0x334155), cx, cz),
        lineMesh(element.paths, element.height, wallColor.clone().multiplyScalar(0.7), cx, cz),
      );
      group.position.set(cx, 0, cz);
      break;
    }
    case 'lines': {
      const { x: cx, y: cz } = elementCenter(element);
      group.add(lineMesh(element.paths, 0.03, color(element.color), cx, cz));
      group.position.set(cx, 0, cz);
      break;
    }
    case 'zone': {
      const { x: cx, y: cz } = elementCenter(element);
      const shape = new THREE.Shape();
      for (let i = 0; i + 1 < element.points.length; i += 2) {
        const x = element.points[i] - cx;
        const y = element.points[i + 1] - cz;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: color(element.color), transparent: true, opacity: element.opacity, side: THREE.DoubleSide, depthWrite: false }),
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.01;
      const outline = [...element.points, element.points[0], element.points[1]];
      group.add(mesh, lineMesh([outline], 0.015, color(element.color), cx, cz));
      group.position.set(cx, 0, cz);
      break;
    }
    case 'box': {
      const boxColor = color(element.color);
      const height = Math.max(0.02, element.h);
      const geometry = new THREE.BoxGeometry(Math.max(0.02, element.w), height, Math.max(0.02, element.d));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: boxColor, transparent: element.opacity < 1, opacity: element.opacity, depthWrite: element.opacity >= 1 }));
      mesh.position.y = height / 2;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: boxColor, transparent: true, opacity: 0.85 }));
      edges.position.y = height / 2;
      group.add(mesh, edges);
      if (element.outline?.length) group.add(lineMesh(element.outline.map((path) => [...path, path[0], path[1]]), 0.03, boxColor, 0, 0));
      if (element.label || element.code) {
        const tag = label(element.label || element.code || '', 'eq-map-code');
        tag.position.y = height + 0.2;
        group.add(tag);
      }
      group.position.set(element.x, 0, element.y);
      group.rotation.y = (-element.rotation * Math.PI) / 180;
      break;
    }
    case 'label': {
      const tag = label(element.text, element.size === 'small' ? 'eq-map-note' : 'eq-map-room');
      tag.position.y = 0.2;
      // Punt invisible per poder-lo seleccionar amb el ratolí.
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.2;
      group.add(tag, hit);
      group.position.set(element.x, 0, element.y);
      break;
    }
    case 'image': {
      const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: element.opacity, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
      new THREE.TextureLoader().load(
        assetUrl(element.assetId),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map = texture;
          material.needsUpdate = true;
        },
        undefined,
        () => onModelError(`No s’ha pogut carregar la imatge ${element.fileName}`),
      );
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, element.w), Math.max(0.1, element.d)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.005;
      mesh.renderOrder = -1;
      group.add(mesh);
      group.position.set(element.x, 0, element.y);
      group.rotation.y = (-element.rotation * Math.PI) / 180;
      break;
    }
    case 'model': {
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x94a3b8, wireframe: true }));
      placeholder.position.y = 0.5;
      group.add(placeholder);
      loadModel(assetUrl(element.assetId), element.fileName, element.color || '#94a3b8')
        .then((object) => {
          group.remove(placeholder);
          placeholder.geometry.dispose();
          group.add(groundModel(object));
        })
        .catch((error: Error) => onModelError(`${element.fileName}: ${error.message}`));
      group.position.set(element.x, element.z, element.y);
      group.rotation.y = (-element.rotation * Math.PI) / 180;
      group.scale.setScalar(element.scale || 1);
      break;
    }
  }
  return group;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((node) => {
    if (node instanceof CSS2DObject) node.element.remove();
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments || node instanceof THREE.Line) {
      node.geometry?.dispose();
      const material = node.material as THREE.Material | THREE.Material[];
      (Array.isArray(material) ? material : [material]).forEach((item) => {
        (item as THREE.MeshBasicMaterial).map?.dispose();
        item.dispose();
      });
    }
  });
}

/** Aplica el que s'ha fet amb les manetes a les dades de l'element. */
function applyTransform(element: SceneElement, object: THREE.Object3D, start: { position: THREE.Vector3; rotation: number; scale: number }, grid: number): SceneElement {
  const dx = object.position.x - start.position.x;
  const dz = object.position.z - start.position.z;
  const turned = object.rotation.y - start.rotation;
  const scaled = object.scale.x / (start.scale || 1);
  const scaleY = object.scale.y / (start.scale || 1);
  const scaleZ = object.scale.z / (start.scale || 1);
  const degrees = (radians: number) => round(((-radians * 180) / Math.PI + 360 * 10) % 360, 0.1);

  switch (element.kind) {
    case 'wall':
    case 'lines':
    case 'zone': {
      let next: SceneElement = translateElement(element, dx, dz);
      if (Math.abs(turned) > 1e-6 || Math.abs(scaled - 1) > 1e-6 || Math.abs(scaleZ - 1) > 1e-6) {
        // Gira i escala els punts al voltant del centre.
        const center = elementCenter(next);
        const cos = Math.cos(-turned);
        const sin = Math.sin(-turned);
        const map = (list: number[]) => {
          const out: number[] = [];
          for (let i = 0; i + 1 < list.length; i += 2) {
            const x = (list[i] - center.x) * scaled;
            const y = (list[i + 1] - center.y) * scaleZ;
            out.push(round(center.x + x * cos - y * sin), round(center.y + x * sin + y * cos));
          }
          return out;
        };
        next = next.kind === 'zone' ? { ...next, points: map(next.points) } : { ...(next as WallElement), paths: (next as WallElement).paths.map(map) };
        if (next.kind === 'wall' && Math.abs(scaleY - 1) > 1e-6) next = { ...next, height: round(next.height * scaleY, 0.01) };
      }
      return next;
    }
    case 'box':
      return {
        ...element,
        x: round(snap(object.position.x, grid / 2)),
        y: round(snap(object.position.z, grid / 2)),
        rotation: degrees(object.rotation.y),
        w: round(Math.max(0.05, element.w * scaled), 0.01),
        h: round(Math.max(0.02, element.h * scaleY), 0.01),
        d: round(Math.max(0.05, element.d * scaleZ), 0.01),
      };
    case 'image':
      return {
        ...element,
        x: round(object.position.x),
        y: round(object.position.z),
        rotation: degrees(object.rotation.y),
        w: round(Math.max(0.1, element.w * scaled), 0.01),
        d: round(Math.max(0.1, element.d * scaleZ), 0.01),
      };
    case 'model':
      return {
        ...element,
        x: round(object.position.x),
        y: round(object.position.z),
        z: round(object.position.y, 0.01),
        rotation: degrees(object.rotation.y),
        scale: round(Math.max(0.0001, object.scale.x), 0.0001),
      };
    case 'label':
      return { ...element, x: round(snap(object.position.x, grid / 2)), y: round(snap(object.position.z, grid / 2)) };
  }
}

export default function MapSceneView(props: MapSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{
    sync: () => void;
    setMarkers: () => void;
    setView: (view: '3d' | 'top') => void;
    setTool: () => void;
    focus: () => void;
    fit: () => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf1f5f9);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'pointer-events-none absolute inset-0';
    host.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 1;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);
    let grid: THREE.GridHelper | null = null;

    const content = new THREE.Group();
    scene.add(content);
    const built = new Map<string, { element: SceneElement; object: THREE.Object3D }>();
    const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xf59e0b);
    selectionBox.visible = false;
    scene.add(selectionBox);

    const transform = new TransformControls(camera, renderer.domElement);
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);
    let transformStart: { position: THREE.Vector3; rotation: number; scale: number } | null = null;
    transform.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
      const id = propsRef.current.selectedElementId;
      const entry = id ? built.get(id) : null;
      if (!entry) return;
      if (event.value) {
        transformStart = { position: entry.object.position.clone(), rotation: entry.object.rotation.y, scale: entry.object.scale.x };
      } else if (transformStart) {
        const next = applyTransform(entry.element, entry.object, transformStart, propsRef.current.scene.grid ?? 0.5);
        transformStart = null;
        propsRef.current.onChangeElement(next);
      }
    });
    transform.addEventListener('objectChange', () => selectionBox.update());

    // ── Equips ──
    const markers = new THREE.Group();
    scene.add(markers);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 40), new THREE.MeshBasicMaterial({ color: 0x0e7c86, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    const stemGeometry = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8);
    const headGeometry = new THREE.SphereGeometry(0.45, 20, 16);

    // ── Dibuix ──
    const ghost = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24), new THREE.MeshBasicMaterial({ color: DRAW_COLOR, transparent: true, opacity: 0.6 }));
    ghost.visible = false;
    scene.add(ghost);
    const ghostLabel = label('', 'eq-map-ghost');
    ghostLabel.visible = false;
    ghostLabel.position.set(0, 0.8, 0);
    ghost.add(ghostLabel);
    const draft = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: DRAW_COLOR }));
    draft.frustumCulled = false;
    scene.add(draft);
    const draftLabel = label('', 'eq-map-ghost');
    draftLabel.visible = false;
    scene.add(draftLabel);
    let points: { x: number; y: number }[] = [];
    let boxStart: { x: number; y: number } | null = null;
    let measure: { x: number; y: number }[] = [];

    function bounds() {
      const { scene: data, markers: list } = propsRef.current;
      return sceneBounds(data, list);
    }

    function layoutFloor() {
      const [x0, y0, x1, y1] = bounds();
      const margin = Math.max(8, (x1 - x0) * 0.15);
      floor.scale.set(x1 - x0 + margin * 2, y1 - y0 + margin * 2, 1);
      floor.position.set((x0 + x1) / 2, -0.02, (y0 + y1) / 2);
      const editing = !['view', 'place'].includes(propsRef.current.tool);
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
        grid = null;
      }
      if (editing) {
        const step = propsRef.current.scene.grid ?? 0.5;
        const size = Math.ceil(Math.max(x1 - x0, y1 - y0) + margin * 2);
        const divisions = Math.min(600, Math.ceil(size / step));
        grid = new THREE.GridHelper(divisions * step, divisions, 0xcbd5e1, 0xe2e8f0);
        grid.position.set(snap((x0 + x1) / 2, step), -0.01, snap((y0 + y1) / 2, step));
        scene.add(grid);
      }
    }

    /** Sincronitza els objectes amb les dades (només reconstrueix el que ha canviat). */
    function sync() {
      const { scene: data, assetUrl, onModelError } = propsRef.current;
      const seen = new Set<string>();
      const hidden = new Set(data.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
      for (const element of data.elements) {
        seen.add(element.id);
        const current = built.get(element.id);
        if (!current || current.element !== element) {
          if (current) {
            if (transform.object === current.object) transform.detach();
            content.remove(current.object);
            disposeObject(current.object);
          }
          const object = buildElement(element, assetUrl, onModelError);
          content.add(object);
          built.set(element.id, { element, object });
        }
        // Les etiquetes (CSS2D) dels objectes amagats també s'amaguen: el renderer mira els pares.
        built.get(element.id)!.object.visible = !hidden.has(element.layer);
      }
      for (const [id, entry] of built) {
        if (seen.has(id)) continue;
        if (transform.object === entry.object) transform.detach();
        content.remove(entry.object);
        disposeObject(entry.object);
        built.delete(id);
      }
      layoutFloor();
      setTool();
    }

    function setMarkers() {
      const { markers: list, selectedId, highlight, tool } = propsRef.current;
      for (const child of [...markers.children]) {
        markers.remove(child);
        child.traverse((node) => {
          if (node instanceof CSS2DObject) node.element.remove();
          if (node instanceof THREE.Mesh) (node.material as THREE.Material).dispose();
        });
      }
      ring.visible = false;
      const editing = !['view', 'place'].includes(tool);
      for (const marker of list) {
        const dim = editing || (highlight !== null && !highlight.has(marker.id));
        const selected = marker.id === selectedId;
        const group = new THREE.Group();
        group.userData.id = marker.id;
        const markerColor = STATE_COLOR[marker.state];
        const stem = new THREE.Mesh(stemGeometry, new THREE.MeshStandardMaterial({ color: 0x475569, transparent: dim, opacity: dim ? 0.15 : 1 }));
        stem.position.y = 1.2;
        const head = new THREE.Mesh(
          headGeometry,
          new THREE.MeshStandardMaterial({ color: markerColor, emissive: markerColor, emissiveIntensity: selected ? 0.6 : 0.25, transparent: dim, opacity: dim ? 0.2 : 1 }),
        );
        head.position.y = 2.6;
        head.scale.setScalar(selected ? 1.5 : marker.critical ? 1.15 : 1);
        group.add(stem, head);
        if (!dim && (selected || highlight !== null || marker.state === 'DOWN')) {
          const tag = label(marker.name, `eq-map-tag${marker.state === 'DOWN' ? ' eq-map-tag-down' : ''}${selected ? ' eq-map-tag-selected' : ''}`);
          tag.position.y = 3.5;
          group.add(tag);
        }
        group.position.set(marker.x, 0, marker.y);
        markers.add(group);
        if (selected) {
          ring.position.set(marker.x, 0.06, marker.y);
          ring.visible = true;
        }
      }
    }

    /** Eina activa: manetes, selecció, botons del ratolí i esborranys. */
    function setTool() {
      const { tool, selectedElementId, transformMode, scene: data } = propsRef.current;
      const entry = selectedElementId ? built.get(selectedElementId) : null;
      if (entry && tool !== 'view' && tool !== 'place') {
        selectionBox.setFromObject(entry.object);
        selectionBox.visible = entry.object.visible;
      } else {
        selectionBox.visible = false;
      }
      const movable = tool === 'select' && entry && entry.object.visible && !entry.element.locked;
      if (movable) {
        if (transform.object !== entry.object) transform.attach(entry.object);
        const kind = entry.element.kind;
        const mode: TransformMode = kind === 'label' || (kind === 'lines' && transformMode === 'scale') ? 'translate' : transformMode;
        transform.setMode(mode);
        transform.showX = mode !== 'rotate';
        transform.showZ = mode !== 'rotate';
        transform.showY = mode === 'rotate' || (mode === 'translate' && kind === 'model') || (mode === 'scale' && (kind === 'box' || kind === 'wall' || kind === 'model'));
        transform.setTranslationSnap(mode === 'translate' && kind !== 'model' ? (data.grid ?? 0.5) / 2 : null);
        transform.setRotationSnap(THREE.MathUtils.degToRad(5));
      } else if (transform.object) {
        transform.detach();
      }
      const drawing = ['wall', 'zone', 'box', 'label', 'measure', 'place'].includes(tool);
      controls.mouseButtons = drawing
        ? { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: propsRef.current.view === 'top' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE }
        : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      if (propsRef.current.view === 'top' && !drawing) controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      renderer.domElement.style.cursor = drawing ? 'crosshair' : '';
      if (tool !== 'wall' && tool !== 'zone') points = [];
      if (tool !== 'box') boxStart = null;
      if (tool !== 'measure') measure = [];
      if (tool !== 'place') ghost.visible = false;
      updateDraft(null);
    }

    function setView(view: '3d' | 'top') {
      const target = controls.target.clone();
      const [x0, y0, x1, y1] = bounds();
      const span = Math.max(x1 - x0, y1 - y0, 10);
      if (view === 'top') {
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = 0.0001;
        controls.enableRotate = false;
        camera.position.set(target.x, span * 1.25, target.z + 0.01);
      } else {
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI / 2.1;
        controls.enableRotate = true;
        camera.position.set(target.x - span * 0.2, span * 0.8, target.z + span * 0.95);
      }
      controls.maxDistance = span * 4;
      camera.up.set(0, 1, 0);
      controls.update();
      setTool();
    }

    function fit() {
      const [x0, y0, x1, y1] = bounds();
      controls.target.set((x0 + x1) / 2, 0, (y0 + y1) / 2);
      setView(propsRef.current.view);
    }

    function focus() {
      const { markers: list, selectedId, view } = propsRef.current;
      const marker = list.find((item) => item.id === selectedId);
      if (!marker) return;
      const target = new THREE.Vector3(marker.x, 0, marker.y);
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(Math.min(offset.length(), view === 'top' ? 45 : 40));
      controls.target.copy(target);
      camera.position.copy(target.clone().add(offset));
      controls.update();
    }

    // ── Mida ──
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = host;
      if (!width || !height) return;
      renderer.setSize(width, height);
      labels.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // ── Ratolí ──
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.3 };
    const pointer = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let down: { x: number; y: number; button: number } | null = null;
    let lastClick = 0;

    function cast(event: PointerEvent | MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    }

    function groundHit(snapIt: boolean): { x: number; y: number } | null {
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, hit)) return null;
      const step = snapIt ? propsRef.current.scene.grid ?? 0.5 : 0;
      return { x: round(snap(hit.x, step), 0.01), y: round(snap(hit.z, step), 0.01) };
    }

    function updateDraft(cursor: { x: number; y: number } | null) {
      const { tool } = propsRef.current;
      let line: { x: number; y: number }[] = [];
      let text = '';
      if ((tool === 'wall' || tool === 'zone') && points.length) {
        line = cursor ? [...points, cursor] : [...points];
        if (tool === 'zone' && line.length > 2) line.push(line[0]);
        const last = line.length >= 2 ? Math.hypot(line[line.length - 1].x - line[line.length - 2].x, line[line.length - 1].y - line[line.length - 2].y) : 0;
        text = last ? `${last.toFixed(2)} m` : '';
      } else if (tool === 'box' && boxStart && cursor) {
        line = [boxStart, { x: cursor.x, y: boxStart.y }, cursor, { x: boxStart.x, y: cursor.y }, boxStart];
        text = `${Math.abs(cursor.x - boxStart.x).toFixed(2)} × ${Math.abs(cursor.y - boxStart.y).toFixed(2)} m`;
      } else if (tool === 'measure' && measure.length) {
        const end = measure[1] ?? cursor;
        if (end) {
          line = [measure[0], end];
          text = `${Math.hypot(end.x - measure[0].x, end.y - measure[0].y).toFixed(2)} m`;
        }
      }
      draft.geometry.dispose();
      draft.geometry = new THREE.BufferGeometry().setFromPoints(line.map((point) => new THREE.Vector3(point.x, 0.05, point.y)));
      draft.visible = line.length >= 2;
      draftLabel.element.textContent = text;
      // CSS2DRenderer reescriu `display` a cada fotograma: s'amaga amb `visible`.
      draftLabel.visible = !!text && line.length > 0;
      if (line.length) {
        const end = line[line.length - (tool === 'zone' && line.length > 2 ? 2 : 1)];
        draftLabel.position.set(end.x, 0.6, end.y);
      }
    }

    function finishShape() {
      const { tool, onCreateElement, scene: data } = propsRef.current;
      const layer = data.layers[0]?.id ?? 'structure';
      if (tool === 'wall' && points.length >= 2) {
        onCreateElement({ id: newId(), kind: 'wall', layer, paths: [points.flatMap((point) => [point.x, point.y])], height: 3, color: '#cbd5e1', opacity: 0.5 } satisfies WallElement);
      } else if (tool === 'zone' && points.length >= 3) {
        onCreateElement({ id: newId(), kind: 'zone', layer, points: points.flatMap((point) => [point.x, point.y]), color: '#16a34a', opacity: 0.18 } satisfies ZoneElement);
      }
      points = [];
      updateDraft(null);
    }

    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY, button: event.button };
      if (event.button !== 0) return;
      const { tool } = propsRef.current;
      if (tool === 'box') {
        cast(event);
        boxStart = groundHit(true);
      }
    };

    const onMove = (event: PointerEvent) => {
      const { tool, scene: data } = propsRef.current;
      cast(event);
      if (tool === 'place') {
        const hit = groundHit(false);
        ghost.visible = !!hit;
        if (hit) {
          const code = nearestCode(data, hit.x, hit.y);
          const point = code ?? hit;
          ghost.position.set(point.x, 0.05, point.y);
          ghostLabel.element.textContent = code ? code.code : '';
          ghostLabel.visible = !!code;
        }
        return;
      }
      if (tool === 'wall' || tool === 'zone' || tool === 'box' || tool === 'measure') updateDraft(groundHit(tool !== 'measure'));
    };

    const onUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.button !== 0) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5;
      const props = propsRef.current;
      cast(event);

      if (props.tool === 'box') {
        const end = groundHit(true);
        if (boxStart && end && Math.abs(end.x - boxStart.x) >= 0.2 && Math.abs(end.y - boxStart.y) >= 0.2) {
          props.onCreateElement({
            id: newId(),
            kind: 'box',
            layer: props.scene.layers[1]?.id ?? props.scene.layers[0]?.id ?? 'furniture',
            x: round((boxStart.x + end.x) / 2),
            y: round((boxStart.y + end.y) / 2),
            w: round(Math.abs(end.x - boxStart.x)),
            d: round(Math.abs(end.y - boxStart.y)),
            h: 2,
            rotation: 0,
            color: '#2563eb',
            opacity: 0.3,
          } satisfies BoxElement);
        }
        boxStart = null;
        updateDraft(null);
        return;
      }
      if (moved) return;

      if (props.tool === 'place') {
        const hit = groundHit(false);
        if (!hit) return;
        const code = nearestCode(props.scene, hit.x, hit.y);
        props.onPlace(code ? { x: code.x, y: code.y, code: code.code } : { x: hit.x, y: hit.y, code: null });
        return;
      }
      if (props.tool === 'wall' || props.tool === 'zone') {
        const now = Date.now();
        const double = now - lastClick < 350;
        lastClick = now;
        if (double) return finishShape();
        const hit = groundHit(true);
        if (!hit) return;
        const last = points[points.length - 1];
        // Clic sobre el primer punt d'una zona: la tanca.
        if (props.tool === 'zone' && points.length >= 3 && Math.hypot(hit.x - points[0].x, hit.y - points[0].y) < 0.3) return finishShape();
        if (!last || last.x !== hit.x || last.y !== hit.y) points.push(hit);
        updateDraft(hit);
        return;
      }
      if (props.tool === 'label') {
        const hit = groundHit(true);
        const text = hit ? window.prompt('Text de l’etiqueta')?.trim() : null;
        if (hit && text) {
          props.onCreateElement({ id: newId(), kind: 'label', layer: props.scene.layers.find((layer) => layer.id === 'labels')?.id ?? props.scene.layers[0]?.id ?? 'labels', x: hit.x, y: hit.y, text: text.slice(0, 120), size: 'normal' } satisfies LabelElement);
        }
        return;
      }
      if (props.tool === 'measure') {
        const hit = groundHit(false);
        if (!hit) return;
        measure = measure.length >= 2 ? [hit] : [...measure, hit];
        props.onMeasure(measure.length === 2 ? Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y) : null);
        updateDraft(null);
        return;
      }
      if (props.tool === 'select') {
        if (transform.dragging) return;
        const objects = [...built.values()].filter((entry) => entry.object.visible).map((entry) => entry.object);
        const hits = raycaster.intersectObjects(objects, true);
        let node: THREE.Object3D | null = hits[0]?.object ?? null;
        while (node && !node.userData.elementId) node = node.parent;
        props.onSelectElement(node ? (node.userData.elementId as string) : null);
        return;
      }
      // Visor: clic en una agulla.
      const hits = raycaster.intersectObjects(markers.children, true);
      let node: THREE.Object3D | null = hits[0]?.object ?? null;
      while (node && !node.userData.id) node = node.parent;
      props.onSelect(node ? (node.userData.id as string) : null);
    };

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const { tool } = propsRef.current;
      if (tool === 'wall' || tool === 'zone') {
        if (event.key === 'Enter') finishShape();
        if (event.key === 'Backspace' && points.length) {
          event.preventDefault();
          points.pop();
          updateDraft(null);
        }
        if (event.key === 'Escape') {
          points = [];
          updateDraft(null);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', onKey);

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      if (selectionBox.visible) selectionBox.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    loop();

    apiRef.current = { sync, setMarkers, setView, setTool, focus, fit };
    sync();
    setMarkers();
    fit();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKey);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      transform.detach();
      transform.dispose();
      controls.dispose();
      scene.traverse((node) => disposeObject(node));
      renderer.dispose();
      host.innerHTML = '';
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.sync();
  }, [props.scene]);

  useEffect(() => {
    apiRef.current?.setView(props.view);
  }, [props.view]);

  useEffect(() => {
    apiRef.current?.setMarkers();
  }, [props.markers, props.selectedId, props.highlight, props.tool]);

  useEffect(() => {
    apiRef.current?.sync();
  }, [props.tool, props.selectedElementId, props.transformMode]);

  useEffect(() => {
    if (props.focusToken) apiRef.current?.focus();
  }, [props.focusToken]);

  useEffect(() => {
    if (props.fitToken) apiRef.current?.fit();
  }, [props.fitToken]);

  return <div ref={hostRef} className="eq-map relative h-full w-full overflow-hidden" />;
}
