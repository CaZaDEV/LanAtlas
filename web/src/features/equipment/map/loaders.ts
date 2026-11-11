import * as THREE from 'three';

/**
 * Carrega un model 3D desat al mapa (GLB/GLTF, OBJ, STL, FBX, PLY, 3MF, DAE) com a objecte de three.js.
 * GLTF amb fitxers externs (.bin, textures) no es pot resoldre: cal exportar-lo com a GLB (un sol fitxer).
 * Els models comprimits amb Draco o Meshopt tampoc s'admeten (no es carreguen descodificadors de fora).
 */
const cache = new Map<string, Promise<THREE.Object3D>>();

export function loadModel(url: string, fileName: string, color: string): Promise<THREE.Object3D> {
  const key = `${url}|${color}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(url, fileName, color);
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending.then((object) => object.clone(true));
}

async function load(url: string, fileName: string, color: string): Promise<THREE.Object3D> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const material = () => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      return gltf.scene;
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const object = await new OBJLoader().loadAsync(url);
      object.traverse((node) => {
        if (node instanceof THREE.Mesh) node.material = material();
      });
      return object;
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = await new STLLoader().loadAsync(url);
      geometry.computeVertexNormals();
      // Els STL solen tenir la Z cap amunt.
      const mesh = new THREE.Mesh(geometry, material());
      mesh.rotation.x = -Math.PI / 2;
      return new THREE.Group().add(mesh);
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geometry = await new PLYLoader().loadAsync(url);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, geometry.hasAttribute('color') ? new THREE.MeshStandardMaterial({ vertexColors: true }) : material());
      return new THREE.Group().add(mesh);
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      return new FBXLoader().loadAsync(url);
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      const object = await new ThreeMFLoader().loadAsync(url);
      object.rotation.x = -Math.PI / 2;
      return new THREE.Group().add(object);
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const collada = await new ColladaLoader().loadAsync(url);
      if (!collada) throw new Error('No s’ha pogut llegir el DAE');
      return collada.scene;
    }
    default:
      throw new Error(`Format de model no admès: .${ext}`);
  }
}

/** Mida del model sense escalar (m), per proposar l'escala en importar-lo. */
export function modelSize(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}

/** Posa el model amb la base a terra i centrat a l'origen (en coordenades locals). */
export function groundModel(object: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  return new THREE.Group().add(object);
}
