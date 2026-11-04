// Pose blending: shape/expression morphs, state cross-fades and the ambient
// offsets that ride on top. Every blend uses the same easing contract.
import { TAU, lerp } from '../math/index.js';
import type { ArcSpec, DotSpec, EyeShape, Pose, Silhouette } from '../types.js';

function blendEye(from: EyeShape, to: EyeShape, k: number): EyeShape {
  return {
    w: lerp(from.w, to.w, k),
    h: lerp(from.h, to.h, k),
    open: lerp(from.open, to.open, k),
    tilt: lerp(from.tilt ?? 0, to.tilt ?? 0, k),
  };
}

function blendSilhouette(from: Silhouette, to: Silhouette, k: number): Silhouette {
  const out: Silhouette = {
    radii: Array<number>(64),
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
  };
  for (let i = 0; i < 64; i++) {
    out.radii[i] = lerp(from.radii[i] ?? 1, to.radii[i] ?? 1, k);
  }
  let delta = to.rot - from.rot;
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  out.rot = from.rot + delta * k;
  out.cx = lerp(from.cx, to.cx, k);
  out.cy = lerp(from.cy, to.cy, k);
  out.sx = lerp(from.sx, to.sx, k);
  out.sy = lerp(from.sy, to.sy, k);
  return out;
}

/** Cross-fade two poses. Dots and arcs from both sides are kept, faded by weight. */
export function blendPose(from: Pose, to: Pose, k: number): Pose {
  const rest = 1 - k;
  return {
    sil: blendSilhouette(from.sil, to.sil, k),
    offX: lerp(from.offX, to.offX, k),
    offY: lerp(from.offY, to.offY, k),
    gaze: {
      yaw: lerp(from.gaze.yaw, to.gaze.yaw, k),
      pitch: lerp(from.gaze.pitch, to.gaze.pitch, k),
      roll: lerp(from.gaze.roll, to.gaze.roll, k),
    },
    split: lerp(from.split, to.split, k),
    eyes: [blendEye(from.eyes[0], to.eyes[0], k), blendEye(from.eyes[1], to.eyes[1], k)],
    eyeAlpha: lerp(from.eyeAlpha, to.eyeAlpha, k),
    bodyAlpha: lerp(from.bodyAlpha, to.bodyAlpha, k),
    dots: [
      ...from.dots.map((dot: DotSpec) => ({ ...dot, opacity: dot.opacity * rest })),
      ...to.dots.map((dot: DotSpec) => ({ ...dot, opacity: dot.opacity * k })),
    ],
    arcs: [
      ...from.arcs.map((arc: ArcSpec) => ({
        ...arc,
        id: `a${arc.id}`,
        opacity: arc.opacity * rest,
      })),
      ...to.arcs.map((arc: ArcSpec) => ({
        ...arc,
        id: `b${arc.id}`,
        opacity: arc.opacity * k,
      })),
    ],
    notif: k < 0.5 ? from.notif : to.notif,
    dotsBehind: k < 0.5 ? from.dotsBehind : to.dotsBehind,
  };
}
