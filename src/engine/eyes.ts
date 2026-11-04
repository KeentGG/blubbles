// Eye geometry: the sphere basis from yaw/pitch/roll, the rounded-rect cut-out
// path, and the footprint used by the precomputed gaze-offset tables.
import { sampleRadiiAt } from '../geometry/silhouette.js';
import { r2 } from '../math/index.js';
import type { EyeShape, Gaze, Silhouette } from '../types.js';

type Vec3 = [number, number, number];

export interface EyeProjection {
  x: number;
  y: number;
  a: number;
  b: number;
  c: number;
  d: number;
  depth: number;
}

export interface EyeFootprint {
  x: number;
  y: number;
  ax: number;
  ay: number;
  r: number;
  m: [number, number, number, number];
}

const deg2rad = (degrees: number): number => (degrees * Math.PI) / 180;

function rotateVectors(a: Vec3, b: Vec3, angle: number): [Vec3, Vec3] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [a[0] * cos + b[0] * sin, a[1] * cos + b[1] * sin, a[2] * cos + b[2] * sin],
    [b[0] * cos - a[0] * sin, b[1] * cos - a[1] * sin, b[2] * cos - a[2] * sin],
  ];
}

/** Two eye anchors on the sphere, projected to 2D with their surface basis. */
export function eyeBasis(
  gaze: Gaze,
  scale: number,
  split = 15.46,
): [EyeProjection, EyeProjection] {
  let forward: Vec3 = [0, 0, 1];
  let right: Vec3 = [1, 0, 0];
  let up: Vec3 = [0, 1, 0];
  [forward, right] = rotateVectors(forward, right, deg2rad(gaze.yaw));
  [up, forward] = rotateVectors(up, forward, deg2rad(gaze.pitch));
  [right, up] = rotateVectors(right, up, deg2rad(gaze.roll));

  const project = (step: number): EyeProjection => {
    const [direction, side] = rotateVectors(forward, right, deg2rad(split * step));
    return {
      x: direction[0] * scale,
      y: direction[1] * scale,
      a: side[0],
      b: side[1],
      c: up[0],
      d: up[1],
      depth: direction[2],
    };
  };
  return [project(-1), project(1)];
}

/** Rounded rectangle used as the eye cut-out, centred on the origin. */
export function eyePath(width: number, height: number): string {
  const halfW = Math.max(width, 0.01) / 2;
  const halfH = Math.max(height, 0.01) / 2;
  const radius = Math.min(halfW, halfH);
  return `M${r2(-halfW)} ${r2(-halfH + radius)}A${r2(radius)} ${r2(radius)} 0 0 1 ${r2(-halfW + radius)} ${r2(-halfH)}L${r2(halfW - radius)} ${r2(-halfH)}A${r2(radius)} ${r2(radius)} 0 0 1 ${r2(halfW)} ${r2(-halfH + radius)}L${r2(halfW)} ${r2(halfH - radius)}A${r2(radius)} ${r2(radius)} 0 0 1 ${r2(halfW - radius)} ${r2(halfH)}L${r2(-halfW + radius)} ${r2(halfH)}A${r2(radius)} ${r2(radius)} 0 0 1 ${r2(-halfW)} ${r2(halfH - radius)}Z`;
}

export interface LookSample {
  gaze: Gaze;
  split: number;
  eyes: [EyeShape, EyeShape];
}

/**
 * Where each eye lands on the body outline, as an oriented segment. The
 * precomputed offset tables use this to keep the eye inside the silhouette.
 */
export function eyeFootprints(
  look: LookSample,
  silhouette: Silhouette,
  radii: number[],
): EyeFootprint[] {
  const out: EyeFootprint[] = [];
  const bases = eyeBasis(look.gaze, 100, look.split);
  for (let eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
    const base = bases[eyeIndex];
    if (base.depth <= 0.02) continue;
    const eye = look.eyes[eyeIndex];
    const tilt = ((eye.tilt ?? 0) * Math.PI) / 180;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const u = base.a * cos + base.c * sin;
    const c = base.b * cos + base.d * sin;
    const y = -base.a * sin + base.c * cos;
    const d = -base.b * sin + base.d * cos;
    const halfW = Math.max(100 * eye.w, 0.01) / 2;
    const halfH = Math.max(100 * eye.h, 0.01) / 2;
    const small = Math.min(halfW, halfH);
    const tall = halfH > halfW;
    const extra = tall ? halfH - small : halfW - small;
    const sphereScale = sampleRadiiAt(radii, Math.atan2(base.y, base.x) - silhouette.rot);
    out.push({
      x: base.x * sphereScale,
      y: base.y * sphereScale,
      ax: (tall ? y : u) * extra,
      ay: (tall ? d : c) * extra,
      r: small,
      m: [u, c, y, d],
    });
  }
  return out;
}
