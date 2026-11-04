/** Pushes a walker (circle of radius r on the XZ plane) out of box and circle colliders. */
export function collide(colliders, bounds, p, r = 0.4) {
  for (const c of colliders) pushOut(c, p, r);
  if (bounds) {
    p.x = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
    p.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, p.z));
  }
}

/** Pushes p out of one collider. */
function pushOut(c, p, r) {
  if (c.type === 'circle') {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d < min && d > 1e-6) {
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
    return;
  }
  const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
  const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
  } else {
    const pen = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z];
    const m = pen.indexOf(Math.min(...pen));
    if (m === 0) p.x = c.minX - r;
    else if (m === 1) p.x = c.maxX + r;
    else if (m === 2) p.z = c.minZ - r;
    else p.z = c.maxZ + r;
  }
}

/**
 * Collisions for something flying at height y: ordinary colliders (stalls, poles, booths) only
 * matter below LOW; tall structures carry their own height. Returns true if p was pushed.
 */
export const LOW = 4.6;
export function collideFlying(colliders, tall, p, r, y) {
  const x = p.x;
  const z = p.z;
  if (y < LOW) collide(colliders, null, p, r);
  for (const c of tall) if (y < c.h) pushOut(c, p, r); // no per-frame filtered copy
  return p.x !== x || p.z !== z;
}
