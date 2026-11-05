import * as THREE from 'three';

/*
  Trailer shot 'tambola' (shared, 4 s = 120 frames at 30 fps): a round already well under way in the
  Tambola Tent. Opens outside on the tent's sign, then pushes in over the players' tables (tickets
  in front of them) onto the caller and the big number board as three more numbers are called;
  someone at the tables jumps up with a claim near the end. Uses m.tambola.stageShot / callShot /
  claimShot (src/games/tambola.js).
*/
const CALLS = [0.35, 1.45, 2.55];
const CLAIM = 3.0;

export const TAMBOLA_SHOT = {
  duration: 4,
  warm: 0.5,
  setup({ m, state }) {
    const tb = m.tambola;
    state.tb = tb;
    tb.stageShot(24);
    state.w = (x, y, z) => tb.group.localToWorld(new THREE.Vector3(x, y, z));
    // a soft key on the caller's side so faces and the front table read without blowing the board
    const l = new THREE.PointLight(0xffd9a8, 8, 9, 1.6);
    l.position.set(1.5, 2.6, -1.0);
    tb.group.add(l);
  },
  update({ sec, state }) {
    const near = (x) => Math.abs(sec - x) < 1 / 60;
    for (const at of CALLS) {
      if (near(at)) state.tb.callShot();
      if (near(at + 0.5)) state.tb.caller.clearAction();
    }
    if (near(CLAIM)) state.tb.claimShot();
  },
  camera({ u, cam, H, state }) {
    const k = H.easeInOut ? H.easeInOut(u) : H.smooth(u);
    cam.pos.copy(state.w(H.lerp(0.35, 0.5, k), H.lerp(2.5, 2.4, k), H.lerp(13.0, 3.9, k)));
    const tilt = H.smooth(Math.min(1, u / 0.55)); // off the sign and down into the tent early
    cam.look.copy(state.w(H.lerp(0.1, 0, k), H.lerp(3.5, 2.15, tilt), -4.4));
    cam.fov = H.lerp(56, 50, k);
  },
};
