import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
  Static-geometry batching. Phones are bound by draw calls, and most of the mela is built from
  dozens of little meshes that never move (a stall's laddoos, a gate's boxes, a bench's planks).
  mergeStatic() folds every static mesh under a root into one mesh per "material look": meshes
  whose materials differ only in colour share one material and carry the colour per vertex.
*/

// Same rule as utils.shadowify: smaller casters add nothing visible to the 9 cm shadow texels.
const MIN_CASTER_RADIUS = 0.3;
const KEEP = ['position', 'normal', 'uv'];
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();

/** Materials that can trade their .color for a vertex colour without changing the look. */
const RECOLOURABLE = new Set(['MeshStandardMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);
const id = (t) => (t ? t.uuid : '-');

/** k when the emissive is the diffuse colour times k (a "glowing" variant of the colour), else null. */
function emissiveTint(m) {
  const e = m.emissive;
  const c = m.color;
  if (!e || (e.r === 0 && e.g === 0 && e.b === 0)) return null;
  const ch = c.r >= c.g && c.r >= c.b ? 'r' : c.g >= c.b ? 'g' : 'b';
  if (c[ch] <= 0) return null;
  const k = e[ch] / c[ch];
  if (Math.abs(e.r - c.r * k) > 2e-3 || Math.abs(e.g - c.g * k) > 2e-3 || Math.abs(e.b - c.b * k) > 2e-3) return null;
  return Math.round(k * 1000) / 1000;
}

/**
 * Makes a lit material's emissive follow the per-vertex / per-instance colour: set emissive to
 * (k, k, k) and each vertex glows with its own colour times k, as a coloured emissive would.
 */
export function tintEmissive(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif'
    );
  };
  mat.customProgramCacheKey = () => 'tintEmissive';
  return mat;
}

function lookKey(m) {
  if (!RECOLOURABLE.has(m.type) || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.userData.live) return null;
  const tint = emissiveTint(m);
  return [
    m.type, m.roughness, m.metalness, tint !== null ? `tint${tint}` : m.emissive?.getHexString(), m.emissiveIntensity, id(m.map), id(m.emissiveMap), id(m.alphaMap),
    id(m.normalMap), id(m.roughnessMap), id(m.metalnessMap), id(m.envMap), m.side, m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.depthTest,
    m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.toneMapped, m.fog, m.blending, m.flatShading, m.wireframe, m.vertexColors,
  ].join('|');
}

// One shared white material per look, so every merged mesh with the same look reuses it.
const shared = new Map();
function sharedMaterial(key, src) {
  let m = shared.get(key);
  if (!m) {
    m = src.clone();
    m.color.set(0xffffff);
    m.vertexColors = true;
    const tint = emissiveTint(src);
    if (tint !== null) {
      m.emissive.setScalar(tint);
      tintEmissive(m);
    }
    shared.set(key, m);
  }
  return m;
}

/** Stops utils.shadowify (which runs later on the whole scene) from turning a merged batch of tiny goods into a caster. */
export function lockNoCast(mesh) {
  Object.defineProperty(mesh, 'castShadow', { get: () => false, set() {}, configurable: true });
  return mesh;
}

function mergeable(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || o.children.length) return false;
  if (Array.isArray(o.material) || o.geometry.morphAttributes.position || !o.geometry.attributes.position) return false;
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  return true;
}

/**
 * Merges the static meshes under root into one mesh per material look, added to root.
 * skip(o) returning true keeps o and its whole subtree untouched (animated parts, people, signs).
 * Returns the merged meshes.
 */
export function mergeStatic(root, { skip = () => false, freeze = true } = {}) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const buckets = new Map();
  const visit = (o) => {
    if (o !== root && skip(o)) return;
    for (const c of o.children.slice()) visit(c);
    if (o === root || !mergeable(o)) return;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    if (_m.determinant() < 0) return; // mirrored: winding would flip
    const mat = o.material;
    const look = lookKey(mat);
    const geo = o.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    o.matrixWorld.decompose(_v, _q, _s);
    const cast = o.castShadow || (!mat.isMeshBasicMaterial && geo.boundingSphere.radius * Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z)) >= MIN_CASTER_RADIUS);
    const key = [look ?? mat.uuid, o.layers.mask, cast, o.receiveShadow, o.renderOrder, o.frustumCulled].join('#');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { look, mat, cast, src: o, items: [] }));
    b.items.push({ o, m: _m.clone() });
  };
  visit(root);

  const out = [];
  for (const b of buckets.values()) {
    if (b.items.length < 2) continue;
    const recolour = b.look !== null && b.items.some((it) => it.o.material !== b.mat);
    const indexed = b.items.every((it) => it.o.geometry.index);
    const geos = b.items.map(({ o, m }) => {
      let g = o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name) && !(name === 'color' && o.material.vertexColors)) g.deleteAttribute(name);
      g.morphAttributes = {};
      if (!indexed && g.index) g = g.toNonIndexed();
      g.applyMatrix4(m);
      const n = g.attributes.position.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      if (recolour || b.mat.vertexColors) {
        _c.copy(o.material.color);
        const old = g.attributes.color;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = _c.r * (old ? old.getX(i) : 1);
          arr[i * 3 + 1] = _c.g * (old ? old.getY(i) : 1);
          arr[i * 3 + 2] = _c.b * (old ? old.getZ(i) : 1);
        }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      g.clearGroups();
      return g;
    });
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, recolour || b.mat.vertexColors ? sharedMaterial(b.look ?? b.mat.uuid, b.mat) : b.mat);
    const s = b.src;
    mesh.layers.mask = s.layers.mask;
    mesh.receiveShadow = s.receiveShadow;
    mesh.renderOrder = s.renderOrder;
    mesh.frustumCulled = s.frustumCulled;
    if (b.cast) mesh.castShadow = true;
    else lockNoCast(mesh);
    if (freeze) {
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    }
    for (const { o } of b.items) o.removeFromParent();
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** Stops per-frame matrix recomposition for an object tree that never moves (world matrices still follow parents). */
export function freezeStatic(root, skip = () => false) {
  root.updateMatrixWorld(true);
  const visit = (o) => {
    if (skip(o)) return;
    o.matrixAutoUpdate = false;
    for (const c of o.children) visit(c);
  };
  visit(root);
  return root;
}
