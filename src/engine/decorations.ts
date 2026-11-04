// Per-frame decorations: burst dots, arc ribbons and the notification badge with
// its mask notch. These are the only parts of a sample whose order is paint order.
import { sampleRadiiAt } from '../geometry/silhouette.js';
import { clamp, r2 } from '../math/index.js';
import { arcRender } from './arcs.js';
import type { FaceFrame } from './accessories.js';
import { eyeBasis, eyePath } from './eyes.js';
import type {
  ArcSpec,
  CircleSample,
  DotSpec,
  EyeSample,
  Gaze,
  Point,
  Pose,
  RenderDot,
  RenderedArc,
} from '../types.js';

/** Dots that are too faint or too small are dropped before rendering. */
export function sampleDots(
  dots: DotSpec[],
  offsetX: number,
  offsetY: number,
  scale: number,
): RenderDot[] {
  return dots
    .filter((dot) => dot.opacity > 0.01 && dot.r > 5e-4)
    .map((dot) => ({
      ...dot,
      x: (dot.x + offsetX) * scale,
      y: (dot.y + offsetY) * scale,
      r: dot.r * scale,
    }));
}

export function sampleArcs(arcs: ArcSpec[], scale: number): RenderedArc[] {
  return arcs
    .filter((arc) => arc.opacity > 0.01)
    .map((arc) => arcRender(arc.seed, arc.t, scale, arc.id, arc.opacity));
}

export interface NotifGeometry {
  notif: CircleSample | null;
  notch: CircleSample | null;
}

/** Project the notification to the body edge; the notch is the mask cut for it. */
export function sampleNotif(
  pose: Pose,
  offsetX: number,
  offsetY: number,
  scale: number,
): NotifGeometry {
  if (!pose.notif) return { notif: null, notch: null };
  const edge = sampleRadiiAt(
    pose.sil.radii,
    Math.atan2(pose.notif.y, pose.notif.x) - pose.sil.rot,
  );
  const x = (pose.notif.x * edge + offsetX) * scale;
  const y = (pose.notif.y * edge + offsetY) * scale;
  return {
    notif: { x, y, r: pose.notif.r * scale },
    notch: { x, y, r: pose.notif.notch * scale },
  };
}

/**
 * Build the two eye cut-outs. `lid` is already the minimum of the ambient lid and
 * the state's blink; `clearanceOffset` is the precomputed gaze offset for this shape/state.
 */
export function sampleEyes(
  pose: Pose,
  gaze: Gaze,
  scale: number,
  lid: number,
  offsetX: number,
  offsetY: number,
  clearanceOffset: Point,
): EyeSample[] {
  const eyes: EyeSample[] = [];
  if (!(pose.eyeAlpha > 0.01)) return eyes;
  const bases = eyeBasis(gaze, scale, pose.split);
  for (let eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
    const base = bases[eyeIndex];
    if (base.depth <= 0.02) continue;
    const eye = pose.eyes[eyeIndex];
    const edge = sampleRadiiAt(pose.sil.radii, Math.atan2(base.y, base.x) - pose.sil.rot);
    const tilt = ((eye.tilt ?? 0) * Math.PI) / 180;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const u = base.a * cos + base.c * sin;
    const c = base.b * cos + base.d * sin;
    const y = -base.a * sin + base.c * cos;
    const d = -base.b * sin + base.d * cos;
    const squash = 0.06 + 0.94 * clamp(Math.min(lid, eye.open));
    eyes.push({
      d: eyePath(eye.w * scale, eye.h * scale),
      matrix: `matrix(${r2(u)},${r2(c * squash)},${r2(y)},${r2(d * squash)},${r2(base.x * edge + (offsetX + clearanceOffset.x) * scale)},${r2(base.y * edge + (offsetY + clearanceOffset.y) * scale)})`,
      alpha: pose.eyeAlpha * clamp(base.depth / 0.12),
    });
  }
  return eyes;
}

/** Where the face is on the surface: the midpoint of the eyes, even when one is hidden. */
export function faceFrame(
  pose: Pose,
  gaze: Gaze,
  scale: number,
  offsetX: number,
  offsetY: number,
  clearanceOffset: Point,
): FaceFrame | null {
  if (!(pose.eyeAlpha > 0.01)) return null;
  const [left, right] = eyeBasis(gaze, scale, pose.split);
  const place = (base: typeof left): Point => {
    const edge = sampleRadiiAt(pose.sil.radii, Math.atan2(base.y, base.x) - pose.sil.rot);
    return {
      x: base.x * edge + (offsetX + clearanceOffset.x) * scale,
      y: base.y * edge + (offsetY + clearanceOffset.y) * scale,
    };
  };
  const a = place(left);
  const b = place(right);
  const depth = (left.depth + right.depth) / 2;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    ax: (left.a + right.a) / 2,
    ay: (left.b + right.b) / 2,
    cx: left.c,
    cy: left.d,
    alpha: pose.eyeAlpha * clamp(depth / 0.12),
  };
}
