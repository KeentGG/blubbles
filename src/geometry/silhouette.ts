// Outline geometry: 64-point polar silhouettes, ray casting, rounded polygons,
// the smooth union behind the cloud, and Catmull-Rom -> cubic Bezier paths.
import { TAU, clamp, lerp, r2 } from '../math/index.js';
import type { Point, Silhouette } from '../types.js';

export const SILHOUETTE_POINTS = 64;

const ANGLES = Array.from({ length: SILHOUETTE_POINTS }, (_, i) => (i / SILHOUETTE_POINTS) * TAU);
const COS = ANGLES.map(Math.cos);
const SIN = ANGLES.map(Math.sin);

/** Turn a silhouette into its 64 scaled 2D points. `out` is reused when supplied. */
export function rasterizeSilhouette(
  silhouette: Silhouette,
  scale: number,
  out: Point[] = [],
): Point[] {
  const cosRot = Math.cos(silhouette.rot);
  const sinRot = Math.sin(silhouette.rot);
  for (let i = 0; i < SILHOUETTE_POINTS; i++) {
    const radius = silhouette.radii[i] ?? 1;
    const x = radius * (COS[i] ?? 0);
    const y = radius * (SIN[i] ?? 0);
    const rotatedX = x * cosRot - y * sinRot;
    const rotatedY = x * sinRot + y * cosRot;
    const point = out[i] ?? { x: 0, y: 0 };
    point.x = (rotatedX * silhouette.sx + silhouette.cx) * scale;
    point.y = (rotatedY * silhouette.sy + silhouette.cy) * scale;
    out[i] = point;
  }
  out.length = SILHOUETTE_POINTS;
  return out;
}

/** Distance from the origin to a closed polygon, along each of the 64 directions. */
export function raycastRadii(points: Point[], cx: number, cy: number): number[] {
  const radii = Array(SILHOUETTE_POINTS).fill(0);
  const count = points.length;
  for (let i = 0; i < SILHOUETTE_POINTS; i++) {
    const dirX = COS[i] ?? 0;
    const dirY = SIN[i] ?? 0;
    let hit = 0;
    for (let j = 0; j < count; j++) {
      const from = points[j];
      const to = points[(j + 1) % count];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const denominator = dirX * dy - dirY * dx;
      if (1e-9 > Math.abs(denominator)) continue;
      const px = from.x - cx;
      const py = from.y - cy;
      const distance = (px * dy - py * dx) / denominator;
      const along = (px * dirY - py * dirX) / denominator;
      if (distance > hit && along >= 0 && along <= 1) hit = distance;
    }
    radii[i] = hit;
  }
  return radii;
}

/**
 * Outline of two overlapping circles, traced by its two tangent arcs.
 * `segments` is split evenly between the two arcs (inclusive endpoints).
 */
export function arcPolygon(
  cx1: number,
  cy1: number,
  radius1: number,
  cx2: number,
  cy2: number,
  radius2: number,
  segments = 96,
): Point[] {
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const centres = Math.hypot(dx, dy) || 1e-6;
  const direction = Math.atan2(dy, dx);
  const spread = Math.acos(clamp((radius1 - radius2) / centres, -1, 1));
  const points: Point[] = [];
  for (let i = 0; i <= segments / 2; i++) {
    const angle = direction + spread + ((TAU - 2 * spread) * i) / (segments / 2);
    points.push({ x: cx1 + Math.cos(angle) * radius1, y: cy1 + Math.sin(angle) * radius1 });
  }
  for (let i = 0; i <= segments / 2; i++) {
    const angle = direction - spread + (2 * spread * i) / (segments / 2);
    points.push({ x: cx2 + Math.cos(angle) * radius2, y: cy2 + Math.sin(angle) * radius2 });
  }
  return points;
}

/** Sample a 64-entry radii table at an arbitrary angle (wraps). */
export function sampleRadiiAt(radii: number[], angle: number): number {
  const count = radii.length;
  const position = (((angle / TAU) % 1) + 1) % 1;
  const index = Math.floor(position * count);
  return lerp(radii[index % count] ?? 1, radii[(index + 1) % count] ?? 1, position * count - index);
}

/** Round the corners of a polygon by sweeping `radius` circles at each vertex. */
function roundCorners(points: Point[], radius: number, steps = 10): Point[] {
  const count = points.length;
  const out: Point[] = [];
  const edgeAngle = (from: Point, to: Point): number => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return Math.atan2(-dx / length, dy / length);
  };
  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const start = edgeAngle(previous, current);
    let sweep = edgeAngle(current, next) - start;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    for (let step = 0; step <= steps; step++) {
      const angle = start + (sweep * step) / steps;
      out.push({ x: current.x + Math.cos(angle) * radius, y: current.y + Math.sin(angle) * radius });
    }
  }
  return out;
}

/** A regular polygon with rounded corners, expressed as 64 polar radii. */
export function roundedPolygon(
  sides: number,
  radius: number,
  rounding: number,
  rotateDeg = 0,
): number[] {
  const rotation = (rotateDeg * Math.PI) / 180;
  const vertices = Array.from({ length: sides }, (_, i) => {
    const angle = rotation + (i / sides) * TAU;
    return {
      x: Math.cos(angle) * (radius - rounding),
      y: Math.sin(angle) * (radius - rounding),
    };
  });
  return raycastRadii(roundCorners(vertices, rounding), 0, 0);
}

/** Scale a radii table so its maximum equals `target`. */
export function normalizeRadii(radii: number[], target = 1): number[] {
  const max = Math.max(...radii);
  if (max <= 0) return radii;
  const factor = target / max;
  return radii.map((radius) => radius * factor);
}

/**
 * The cloud: a smooth union (k = 0.18) of five circles. A hard union would leave
 * corners that the 64-point outline cannot draw.
 */
export function smoothUnionRadii(circles: (Point & { r: number })[], target = 1): number[] {
  const k = 0.18;
  const smoothMin = (a: number, b: number): number => {
    const blend = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - (blend * blend * blend * k) / 6;
  };
  const distance = (x: number, y: number): number => {
    let value = Math.hypot(x - circles[0].x, y - circles[0].y) - circles[0].r;
    for (let i = 1; i < circles.length; i++) {
      const circle = circles[i];
      value = smoothMin(value, Math.hypot(x - circle.x, y - circle.y) - circle.r);
    }
    return value;
  };
  const radii = Array(SILHOUETTE_POINTS).fill(0);
  for (let i = 0; i < SILHOUETTE_POINTS; i++) {
    const dirX = COS[i] ?? 0;
    const dirY = SIN[i] ?? 0;
    let inside = 2;
    while (inside > 0 && distance(dirX * inside, dirY * inside) > 0) inside -= 0.01;
    let outside = inside + 0.01;
    for (let step = 0; step < 30; step++) {
      const mid = (inside + outside) / 2;
      if (distance(dirX * mid, dirY * mid) > 0) outside = mid;
      else inside = mid;
    }
    radii[i] = (inside + outside) / 2;
  }
  return normalizeRadii(radii, target);
}

/** Catmull-Rom through every point, converted to cubic Beziers (tension 1/6). */
export function catmullRomPath(points: Point[], tension = 1 / 6): string {
  const count = points.length;
  if (count < 3) return '';
  const first = points[0];
  let path = `M${r2(first.x)} ${r2(first.y)}`;
  for (let i = 0; i < count; i++) {
    const before = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const after = points[(i + 2) % count];
    const control1x = current.x + (next.x - before.x) * tension;
    const control1y = current.y + (next.y - before.y) * tension;
    const control2x = next.x - (after.x - current.x) * tension;
    const control2y = next.y - (after.y - current.y) * tension;
    path += `C${r2(control1x)} ${r2(control1y)} ${r2(control2x)} ${r2(control2y)} ${r2(next.x)} ${r2(next.y)}`;
  }
  return `${path}Z`;
}

/** Straight-line closed path through points, rounded like every other path. */
export function polygonPath(points: Point[], scale = 1): string {
  if (points.length < 3) return '';
  let path = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    path += `${i === 0 ? 'M' : 'L'}${r2(point.x * scale)} ${r2(point.y * scale)}`;
  }
  return `${path}Z`;
}
