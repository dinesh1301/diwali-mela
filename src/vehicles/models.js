import * as THREE from 'three';
import { shape, merged } from '../character.js';
import { hdr, canvasTexture } from '../utils.js';
import { slot, slotSet } from '../personalSlots.js';

/*
  Low-poly vehicles in the Sketchbook spirit. Local +z is forward, matching the player's heading
  convention. Each returns { group, seat, parts } where parts holds the bits that animate.
*/

export const vehicleMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x152233, roughness: 0.15, metalness: 0.4 });
const blurMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const lampMat = (hex, k = 4) => new THREE.MeshBasicMaterial({ color: hdr(hex, k) });

const ball = (hex, k, r, x, y, z) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), lampMat(hex, k));
  m.position.set(x, y, z);
  return m;
};

function decal(text, sub, bg) {
  return canvasTexture(512, 128, (c, w, h) => {
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, 28);
    c.fill();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fff1c1';
    let size = 56; // a personal name may be longer than the stock one: shrink to fit the plate
    do c.font = `${size}px "Yatra One", serif`;
    while (c.measureText(text).width > w - 40 && (size -= 2) > 22);
    c.fillText(text, w / 2, sub ? 48 : h / 2);
    if (sub) {
      c.font = '600 24px Poppins, sans-serif';
      c.fillStyle = '#ffd166';
      c.fillText(sub, w / 2, 96);
    }
  });
}

function decalPlane(tex, w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.15, 1.15, 1.15) }));
}

// ---------- Chakri Racer (car) ----------

/*
  A tall, open-sided jeep so a seated character fits under the roof (a seated rig is ~1.5 m from
  hips to hat). The left (+x) door is a pivot the entry animation swings open.
*/
export function carModel(color = 0xe63946) {
  const g = new THREE.Group();
  const dark = 0x1b1b1f;
  const trim = 0xd4a017;
  const body = merged(
    [
      shape(new THREE.BoxGeometry(1.7, 0.65, 3.6), color, [0, 0.545, 0]),
      shape(new THREE.BoxGeometry(1.74, 0.16, 3.64), dark, [0, 0.3, 0]),
      shape(new THREE.BoxGeometry(1.5, 1.0, 1.8), color, [0, 1.37, -0.25]),
      shape(new THREE.BoxGeometry(1.8, 0.22, 0.3), dark, [0, 0.45, 1.85]),
      shape(new THREE.BoxGeometry(1.8, 0.22, 0.3), dark, [0, 0.45, -1.85]),
      shape(new THREE.BoxGeometry(1.2, 0.18, 0.08), dark, [0, 0.75, 1.81]),
      shape(new THREE.BoxGeometry(1.56, 0.06, 1.9), trim, [0, 1.9, -0.25]),
      shape(new THREE.BoxGeometry(0.06, 0.12, 1.7), trim, [-0.6, 1.98, -0.25]),
      shape(new THREE.BoxGeometry(0.06, 0.12, 1.7), trim, [0.6, 1.98, -0.25]),
      shape(new THREE.TorusGeometry(0.46, 0.05, 6, 20), 0xff8c1a, [0, 0.72, 1.86], [0, 0, 0]),
      shape(new THREE.BoxGeometry(0.4, 0.04, 0.3), 0x444444, [-0.95, 1.2, 0.7], [0, 0, 0.3]),
      shape(new THREE.BoxGeometry(0.4, 0.04, 0.3), 0x444444, [0.95, 1.2, 0.7], [0, 0, -0.3]),
      // dashboard and steering wheel for the driver on the left
      shape(new THREE.BoxGeometry(1.4, 0.18, 0.3), dark, [0, 1.02, 0.5]),
      shape(new THREE.TorusGeometry(0.17, 0.025, 6, 18), dark, [0.32, 1.12, 0.3], [-0.55, 0, 0]),
      shape(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), 0x444444, [0.32, 1.0, 0.42], [1.0, 0, 0]),
      // bench seat
      shape(new THREE.BoxGeometry(1.3, 0.12, 0.6), 0x3a2a24, [0, 0.9, -0.4]),
      shape(new THREE.BoxGeometry(1.3, 0.6, 0.12), 0x3a2a24, [0, 1.2, -0.72]),
    ],
    vehicleMaterial
  );
  g.add(body);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.05), glassMat);
  windshield.position.set(0, 1.42, 0.66);
  windshield.rotation.x = -0.28;
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.62, 0.05), glassMat);
  rear.position.set(0, 1.4, -1.16);
  rear.rotation.x = 0.25;
  g.add(windshield, rear);
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.3), glassMat);
  side.position.set(-0.76, 1.45, -0.25);
  g.add(side);

  // the left door, hinged at its front edge
  const door = new THREE.Group();
  door.position.set(0.78, 0, 0.55);
  const doorMesh = merged(
    [
      shape(new THREE.BoxGeometry(0.06, 0.62, 1.0), color, [0.03, 0.56, -0.5]),
      shape(new THREE.BoxGeometry(0.06, 0.12, 1.0), dark, [0.03, 0.3, -0.5]),
      shape(new THREE.BoxGeometry(0.05, 0.08, 1.0), color, [0.02, 0.9, -0.5]),
      shape(new THREE.BoxGeometry(0.05, 0.08, 1.0), color, [0.02, 1.84, -0.5]),
      shape(new THREE.BoxGeometry(0.05, 0.9, 0.08), color, [0.02, 1.37, -0.04]),
      shape(new THREE.BoxGeometry(0.05, 0.9, 0.08), color, [0.02, 1.37, -0.96]),
      shape(new THREE.BoxGeometry(0.03, 0.06, 0.2), trim, [0.06, 0.75, -0.7]),
    ],
    vehicleMaterial
  );
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.82, 0.84), glassMat);
  doorGlass.position.set(0.02, 1.37, -0.5);
  door.add(doorMesh, doorGlass);
  g.add(door);

  g.add(ball(0xfff2c0, 5, 0.11, -0.6, 0.68, 1.84), ball(0xfff2c0, 5, 0.11, 0.6, 0.68, 1.84));
  const tail = [ball(0xff2020, 3, 0.08, -0.65, 0.68, -1.84), ball(0xff2020, 3, 0.08, 0.65, 0.68, -1.84)];
  g.add(...tail);

  const wheelGeo = [shape(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), 0x151515, [], [0, 0, Math.PI / 2]), shape(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), 0xcfcfcf, [], [0, 0, Math.PI / 2])];
  const wheelMesh = () => merged(wheelGeo.map((p) => p.clone()), vehicleMaterial);
  const wheels = [];
  const steer = new THREE.Group();
  g.add(steer);
  for (const [x, z, front] of [[-0.86, 1.15, true], [0.86, 1.15, true], [-0.86, -1.15, false], [0.86, -1.15, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const w = wheelMesh();
    pivot.add(w);
    (front ? steer : g).add(pivot);
    wheels.push({ pivot, mesh: w, front });
  }

  // where the headlight sits and points; the one shared headlight (vehicles.js) moves to whichever
  // car is being driven, so parked cars carry no light at all
  const head = new THREE.Object3D();
  head.position.set(0, 0.8, 1.6);
  const headTarget = new THREE.Object3D();
  headTarget.position.set(0, 0, 14);
  g.add(head, headTarget);

  const seat = new THREE.Object3D();
  seat.position.set(0.32, 0.4, -0.4);
  g.add(seat);

  const plate = decalPlane(decal(slot('ride.cars.plate'), null, '#5c0a10'), 0.9, 0.22);
  plate.position.set(0, 0.6, -1.87);
  plate.rotation.y = Math.PI;
  g.add(plate);
  return { group: g, seat, parts: { wheels, head, headTarget, body, door } };
}

// ---------- Pushpak Heli ----------

export function heliModel(color = 0xd9a21b, stripe = 0xb3122e) {
  const g = new THREE.Group();
  const body = merged(
    [
      shape(new THREE.SphereGeometry(1.0, 18, 12), color, [0, 1.15, 0.1], [], [0.95, 0.85, 1.3]),
      shape(new THREE.CylinderGeometry(0.22, 0.1, 3.4, 10), color, [0, 1.3, -2.7], [Math.PI / 2, 0, 0]),
      shape(new THREE.BoxGeometry(0.06, 1.0, 0.7), stripe, [0, 1.85, -4.2]),
      shape(new THREE.BoxGeometry(1.2, 0.05, 0.4), stripe, [0, 1.45, -3.9]),
      shape(new THREE.BoxGeometry(2.0, 0.06, 0.9), stripe, [0, 1.52, -0.1]),
      shape(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), 0x333333, [-0.75, 0.08, 0.1], [Math.PI / 2, 0, 0]),
      shape(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), 0x333333, [0.75, 0.08, 0.1], [Math.PI / 2, 0, 0]),
      shape(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0x333333, [-0.6, 0.4, 0.8], [0, 0, 0.5]),
      shape(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0x333333, [0.6, 0.4, 0.8], [0, 0, -0.5]),
      shape(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0x333333, [-0.6, 0.4, -0.6], [0, 0, 0.5]),
      shape(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0x333333, [0.6, 0.4, -0.6], [0, 0, -0.5]),
      shape(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), 0x333333, [0, 2.1, 0]),
      shape(new THREE.ConeGeometry(0.12, 0.4, 8), 0xffd166, [0, 2.55, 0]),
    ],
    vehicleMaterial
  );
  g.add(body);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.86, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), glassMat);
  glass.position.set(0, 1.08, 0.55);
  glass.rotation.x = Math.PI / 2;
  glass.scale.set(0.9, 1.0, 0.9);
  g.add(glass);

  const rotor = new THREE.Group();
  rotor.position.set(0, 2.3, 0);
  const blades = merged(
    [shape(new THREE.BoxGeometry(0.2, 0.03, 9.6), 0x2a2a2a), shape(new THREE.BoxGeometry(9.6, 0.03, 0.2), 0x2a2a2a), shape(new THREE.BoxGeometry(0.24, 0.05, 0.24), 0x111111)],
    vehicleMaterial
  );
  rotor.add(blades);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(4.9, 32), blurMat.clone());
  blur.rotation.x = -Math.PI / 2;
  rotor.add(blur);
  g.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.12, 1.95, -4.25);
  tailRotor.add(merged([shape(new THREE.BoxGeometry(0.03, 1.1, 0.12), 0x2a2a2a), shape(new THREE.BoxGeometry(0.03, 0.12, 1.1), 0x2a2a2a)], vehicleMaterial));
  g.add(tailRotor);

  g.add(ball(0xff2020, 3, 0.06, -1.0, 1.52, -0.1), ball(0x20ff40, 3, 0.06, 1.0, 1.52, -0.1), ball(0xffffff, 4, 0.05, 0, 1.4, -4.5));
  const search = new THREE.SpotLight(0xfff0c8, 0, 60, 0.42, 0.45, 1.0);
  search.position.set(0, 0.5, 0.9);
  search.target.position.set(0, -12, 12);
  g.add(search, search.target);

  const seat = new THREE.Object3D();
  seat.position.set(0, 0.36, 0.15);
  g.add(seat);
  const plate = decalPlane(decal('Pushpak Heli', null, '#6a0d2b'), 1.1, 0.27);
  plate.position.set(0.35, 1.25, -1.9);
  plate.rotation.y = Math.PI / 2;
  g.add(plate);
  return { group: g, seat, parts: { rotor, tailRotor, blur, search } };
}

// ---------- Pushpak Viman (plane) ----------

export function planeModel(color = 0xe0b030, wing = 0xb3122e) {
  const g = new THREE.Group();
  const peacock = (x) => [
    shape(new THREE.CircleGeometry(0.32, 16), 0x0a7f8f, [x, 1.95, -2.35], [0, (x > 0 ? 1 : -1) * Math.PI / 2, 0]),
    shape(new THREE.CircleGeometry(0.18, 12), 0x1f3b8f, [x * 1.01, 1.95, -2.35], [0, (x > 0 ? 1 : -1) * Math.PI / 2, 0]),
    shape(new THREE.CircleGeometry(0.07, 8), 0xffd166, [x * 1.02, 1.95, -2.35], [0, (x > 0 ? 1 : -1) * Math.PI / 2, 0]),
  ];
  const body = merged(
    [
      shape(new THREE.CylinderGeometry(0.5, 0.24, 4.4, 14), color, [0, 1.05, -0.2], [Math.PI / 2, 0, 0]),
      shape(new THREE.ConeGeometry(0.5, 0.9, 14), color, [0, 1.05, 2.45], [Math.PI / 2, 0, 0]),
      shape(new THREE.BoxGeometry(9.2, 0.1, 1.5), wing, [0, 0.8, 0.35]),
      shape(new THREE.BoxGeometry(0.9, 0.12, 1.52), 0xffd166, [-4.2, 0.8, 0.35]),
      shape(new THREE.BoxGeometry(0.9, 0.12, 1.52), 0xffd166, [4.2, 0.8, 0.35]),
      shape(new THREE.BoxGeometry(3.2, 0.07, 0.9), wing, [0, 1.15, -2.3]),
      shape(new THREE.BoxGeometry(0.07, 1.3, 0.95), wing, [0, 1.75, -2.35]),
      ...peacock(-0.05),
      ...peacock(0.05),
      shape(new THREE.BoxGeometry(0.06, 0.6, 0.06), 0x444444, [-1.3, 0.45, 0.6]),
      shape(new THREE.BoxGeometry(0.06, 0.6, 0.06), 0x444444, [1.3, 0.45, 0.6]),
      shape(new THREE.BoxGeometry(0.05, 0.4, 0.05), 0x444444, [0, 0.3, -2.1]),
      shape(new THREE.BoxGeometry(0.9, 0.08, 0.6), color, [0, 1.55, 0.95], [-0.5, 0, 0]),
    ],
    vehicleMaterial
  );
  g.add(body);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.04), glassMat);
  screen.position.set(0, 1.7, 0.78);
  screen.rotation.x = -0.45;
  g.add(screen);

  const wheelGeo = [shape(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), 0x151515, [], [0, 0, Math.PI / 2]), shape(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), 0xcfcfcf, [], [0, 0, Math.PI / 2])];
  const wheels = [];
  for (const [x, y, z, s] of [[-1.3, 0.28, 0.6, 1], [1.3, 0.28, 0.6, 1], [0, 0.16, -2.1, 0.55]]) {
    const w = merged(wheelGeo.map((p) => p.clone()), vehicleMaterial);
    w.position.set(x, y, z);
    w.scale.setScalar(s);
    g.add(w);
    wheels.push(w);
  }

  const prop = new THREE.Group();
  prop.position.set(0, 1.05, 2.95);
  prop.add(merged([shape(new THREE.ConeGeometry(0.16, 0.4, 10), 0xffd166, [0, 0, 0.15], [Math.PI / 2, 0, 0]), shape(new THREE.BoxGeometry(0.14, 2.0, 0.04), 0x2a2a2a), shape(new THREE.BoxGeometry(2.0, 0.14, 0.04), 0x2a2a2a)], vehicleMaterial));
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), blurMat.clone());
  prop.add(blur);
  g.add(prop);

  g.add(ball(0xff2020, 3, 0.07, 4.6, 0.86, 0.35), ball(0x20ff40, 3, 0.07, -4.6, 0.86, 0.35), ball(0xffffff, 4, 0.06, 0, 2.45, -2.35));

  const seat = new THREE.Object3D();
  seat.position.set(0, 0.92, 0.15);
  g.add(seat);
  for (const s of [-1, 1]) {
    const plate = decalPlane(decal(slot('ride.viman.plate'), slotSet('ride.viman.plate') ? null : 'पुष्पक विमान', '#6a0d2b'), 1.5, 0.37);
    plate.position.set(s * 0.49, 1.1, -0.9);
    plate.rotation.y = (s * Math.PI) / 2;
    g.add(plate);
  }
  return { group: g, seat, parts: { prop, blur, wheels } };
}
