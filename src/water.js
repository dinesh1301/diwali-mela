import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { settings } from './settings.js';

/*
  The river: a planar reflection (Reflector) whose projected image is pushed around by an
  animated, tileable normal map, so lights smear into long streaks the way they do on real
  water at night. Fresnel fades the reflection into a deep teal when looking straight down,
  a couple of specular terms add moving glints, and a wake term ripples around the boat.
*/

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seamless normal map made from a sum of integer-frequency waves (so it tiles exactly). */
function waveNormalTexture(size = 256) {
  const rnd = mulberry32(11);
  const waves = [];
  while (waves.length < 16) {
    const k = 1 + Math.floor(rnd() * 7);
    const a = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(a) * k);
    const ky = Math.round(Math.sin(a) * k);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, amp: 1 / (1 + k * 0.6), ph: rnd() * Math.PI * 2 });
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((w.kx * x + w.ky * y) * Math.PI * 2) / size + w.ph);
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const S = 3.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = -(r - l) * S;
      const ny = -(d - u) * S;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec3 vWorldPos;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = textureMatrix * vec4(position, 1.0);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform float time;
  uniform vec3 uBoat; // x, strength, z
  uniform vec3 uRipples[4]; // x, z, start time
  varying vec4 vUv;
  varying vec3 vWorldPos;
  #include <common>
  #include <fog_pars_fragment>

  vec2 nm(vec2 uv) {
    return texture2D(tNormal, uv).xy * 2.0 - 1.0;
  }

  void main() {
    vec2 p = vWorldPos.xz;
    // three octaves of drifting ripples
    vec2 n = nm(p * 0.045 + vec2(time * 0.010, time * 0.004))
           + nm(p * 0.11 + vec2(-time * 0.018, time * 0.012)) * 0.6
           + nm(p * 0.27 + vec2(time * 0.03, -time * 0.02)) * 0.35;
    // rings spreading from the boat
    vec2 toB = p - uBoat.xz;
    float d = length(toB);
    float wake = uBoat.y * exp(-d * 0.22) * sin(d * 2.6 - time * 5.0);
    n += (toB / max(d, 0.001)) * wake * 0.8;
    // rings from things dropped in (floated diyas)
    for (int i = 0; i < 4; i++) {
      float age = time - uRipples[i].z;
      if (age > 0.0 && age < 6.0) {
        vec2 toR = p - uRipples[i].xy;
        float dr = length(toR);
        float ring = sin((dr - age * 1.6) * 7.0) * exp(-dr * 0.9) * exp(-age * 0.55) * step(dr, age * 1.6 + 0.5);
        n += (toR / max(dr, 0.001)) * ring * 0.9;
      }
    }

    // the reflection, smeared more vertically than sideways so lights become streaks
    vec4 uv = vUv;
    uv.xy += n * vec2(0.06, 0.22) * uv.w;
    vec3 refl = texture2DProj(tDiffuse, uv).rgb;

    vec3 V = normalize(cameraPosition - vWorldPos);
    float cosT = clamp(V.y, 0.0, 1.0);
    float fres = 0.18 + 0.82 * pow(1.0 - cosT, 3.5);
    vec3 N = normalize(vec3(n.x * 0.35, 1.0, n.y * 0.35));
    vec3 R = reflect(-V, N);
    float glow = pow(max(dot(R, normalize(vec3(0.3, 0.45, -0.85))), 0.0), 90.0);   // the warm haze over the far bank
    float glint = pow(max(dot(R, normalize(vec3(-0.4, 0.8, 0.2))), 0.0), 400.0); // sharp sparkles
    vec3 deep = color * (0.85 + 0.3 * N.x);
    vec3 col = mix(deep, refl, fres) + glow * vec3(1.0, 0.62, 0.35) * 0.28 + glint * vec3(1.0, 0.9, 0.7) * 0.5;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

// The wave normals smear the reflection anyway, so phones skip its 4x MSAA.
export function createWater(scene, { width = 600, depth = 112, y = -1.35, z = -105, resolution = 0.5, multisample = settings.tier === 'low' ? 0 : 4 } = {}) {
  const uniforms = {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tNormal: { value: waveNormalTexture() },
    time: { value: 0 },
    uBoat: { value: new THREE.Vector3(0, 0, 0) },
    uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, -1e9)) },
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  };
  const mesh = new Reflector(new THREE.PlaneGeometry(width, depth), {
    clipBias: 0.003,
    textureWidth: Math.floor(innerWidth * resolution),
    textureHeight: Math.floor(innerHeight * resolution),
    color: 0x10283a,
    multisample,
    shader: { name: 'MelaWater', uniforms, vertexShader, fragmentShader },
  });
  mesh.material.fog = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, y, z);
  scene.add(mesh);
  const u = mesh.material.uniforms;
  return {
    mesh,
    update(t) {
      u.time.value = t;
    },
    setBoat(x, z, strength) {
      u.uBoat.value.set(x, strength, z);
    },
    ripple(x, z) {
      this.rippleI = ((this.rippleI ?? 0) + 1) % 4;
      u.uRipples.value[this.rippleI].set(x, z, u.time.value);
    },
    /** Reflections only need the big static things (layer 0), not people and props. */
    limitReflectionTo(camera, layer = 0) {
      mesh.getReflectionCamera(camera).layers.set(layer);
    },
  };
}
