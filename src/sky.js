import * as THREE from 'three';
import { rand } from './utils.js';

/*
  The sky dome, the stars and a setting sun. All of it rides with the camera. The colours are
  uniforms so the day/night sequence can slide the evening from dusk into a moonless Diwali night.
*/
export function createSky(scene, horizonColor) {
  const group = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(480, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x020108) },
        uHorizon: { value: horizonColor.clone() },
        uGlow: { value: new THREE.Color(0x7a3326) },
        uSunDir: { value: new THREE.Vector3(-0.8, 0.05, 0.55).normalize() },
        uSunGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w; // on the far plane: drawn only where nothing else is
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        uniform float uSunGlow;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = mix(uHorizon, uTop, smoothstep(-0.02, 0.45, h));
          c += uGlow * exp(-abs(h) * 16.0) * 0.45; // warm haze of a city celebrating
          float s = max(dot(normalize(vDir), uSunDir), 0.0);
          c += vec3(1.0, 0.55, 0.25) * pow(s, 18.0) * uSunGlow * 0.5; // the sunset's halo
          c += vec3(1.0, 0.8, 0.5) * pow(s, 260.0) * uSunGlow * 0.9; // the disc itself (kept under the bloom threshold)
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  // Drawn last of the opaque objects, so the depth test throws away every sky pixel the mela
  // already covers instead of shading the full screen first and painting over it.
  dome.renderOrder = 1000;
  dome.frustumCulled = false;
  group.add(dome);

  const N = 2200;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = Math.pow(Math.random(), 0.8) * 0.95 + 0.04;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = r * Math.cos(a) * 440;
    pos[i * 3 + 1] = y * 440;
    pos[i * 3 + 2] = r * Math.sin(a) * 440;
    size[i] = Math.random() < 0.06 ? rand(2.2, 3.2) : rand(0.8, 1.8);
    phase[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio, 2) }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPR;
      varying float vTw;
      void main() {
        vTw = 0.65 + 0.35 * sin(uTime * (1.0 + fract(aPhase) * 2.0) + aPhase);
        vTw *= smoothstep(0.03, 0.3, position.y / 440.0);
        gl_PointSize = aSize * uPR;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.88) * a * vTw * 0.9 * uAlpha, 1.0);
      }`,
  });
  const stars = new THREE.Points(geo, starMat);
  stars.renderOrder = -9; // first of the transparent things (which all come after the dome)
  stars.frustumCulled = false;
  group.add(stars);

  scene.add(group);

  return {
    dome: dome.material.uniforms,
    stars: starMat.uniforms,
    update(t, cameraPosition) {
      group.position.copy(cameraPosition);
      starMat.uniforms.uTime.value = t;
    },
  };
}
