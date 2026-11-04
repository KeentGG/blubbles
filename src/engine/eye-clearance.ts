// Precomputed eye clearance offsets. For every body shape, base-body state and face,
// this finds how far the eyes must slide so both stay inside the silhouette at the
// four extremes of the gaze wander. Computed once at module load.
import { rasterizeSilhouette } from '../geometry/silhouette.js';
import { eyeFootprints, type EyeFootprint, type LookSample } from './eyes.js';
import { SHAPES } from '../catalog/shapes.js';
import { STATES } from '../catalog/states.js';
import { EXPRESSIONS } from '../catalog/expressions.js';
import type { Expression, Point, StateDef } from '../types.js';

/** Clearance kept between an eye footprint and the body outline. */
const SAFETY = 100 * Math.hypot(0.006, 0.007);

const EMPTY: Point = { x: 0, y: 0 };

interface Probe {
  footprints: EyeFootprint[];
  referenceFootprints: EyeFootprint[];
  outline: Point[];
  poseOutline: Point[];
}

function distanceToSegment(
  points: Point[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { d: number; ux: number; uy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let best = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (const point of points) {
    let along = lengthSquared > 0 ? ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSquared : 0;
    along = along < 0 ? 0 : along > 1 ? 1 : along;
    const ex = ax + along * dx - point.x;
    const ey = ay + along * dy - point.y;
    const squared = ex * ex + ey * ey;
    if (squared < best) {
      best = squared;
      bestX = ex;
      bestY = ey;
    }
  }
  const distance = Math.sqrt(best);
  return {
    d: distance,
    ux: distance > 1e-9 ? bestX / distance : 0,
    uy: distance > 1e-9 ? bestY / distance : 0,
  };
}

/** Smallest margin between one probe's eye footprints and an outline, at an offset. */
function clearance(outline: Point[], prints: EyeFootprint[], dx: number, dy: number): number {
  let margin = Infinity;
  for (const print of prints) {
    const ex = print.x + dx;
    const ey = print.y + dy;
    const hit = distanceToSegment(
      outline,
      ex - print.ax,
      ey - print.ay,
      ex + print.ax,
      ey + print.ay,
    );
    const [m0, m1, m2, m3] = print.m;
    const radius =
      print.r * Math.hypot(m0 * hit.ux + m1 * hit.uy, m2 * hit.ux + m3 * hit.uy) + SAFETY;
    if (hit.d - radius < margin) margin = hit.d - radius;
  }
  return margin;
}

/** Worst clearance over every probe, for an offset of the eye centres. */
function worstOver(probes: Probe[], dx: number, dy: number): number {
  let worst = Infinity;
  for (const probe of probes) {
    worst = Math.min(worst, clearance(probe.outline, probe.footprints, dx, dy));
  }
  return worst;
}

/** Choose the smallest shift that gives every probe a non-negative margin. */
function solve(probes: Probe[]): Point {
  if (!probes.length) return { x: 0, y: 0 };

  const worst = (dx: number, dy: number): number => worstOver(probes, dx, dy);

  let allowed = Infinity;
  for (const probe of probes) {
    allowed = Math.min(allowed, clearance(probe.poseOutline, probe.referenceFootprints, 0, 0));
  }
  // The centre of the eye pair is the point we push away from.
  let sumX = 0;
  let sumY = 0;
  const prints = probes[0].footprints;
  for (const print of prints) {
    sumX -= print.x / prints.length;
    sumY -= print.y / prints.length;
  }
  const radius = Math.max(35, 1.25 * Math.hypot(sumX, sumY));
  allowed = Math.min(allowed, worst(sumX, sumY));
  const centred = worst(0, 0);
  if (centred >= allowed && centred >= 0) return { x: 0, y: 0 };

  const threshold = Math.max(allowed, 0);
  let bestX = 0;
  let bestY = 0;
  let bestRadius = Infinity;
  let fallbackX = 0;
  let fallbackY = 0;
  let fallbackMargin = centred;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    if (worst(ux * radius, uy * radius) < threshold) {
      for (const step of [0.3, 0.6, 1]) {
        const margin = worst(ux * radius * step, uy * radius * step);
        if (margin > fallbackMargin) {
          fallbackMargin = margin;
          fallbackX = ux * radius * step;
          fallbackY = uy * radius * step;
        }
      }
      continue;
    }
    let low = 0;
    let high = radius;
    for (let step = 0; step < 8; step++) {
      const mid = (low + high) / 2;
      if (worst(ux * mid, uy * mid) >= threshold) high = mid;
      else low = mid;
    }
    if (high < bestRadius) {
      bestRadius = high;
      bestX = ux * high;
      bestY = uy * high;
    }
  }
  const x = bestRadius === Infinity ? fallbackX : bestX;
  const y = bestRadius === Infinity ? fallbackY : bestY;
  return {
    x: +(x / 100).toFixed(6),
    y: +(y / 100).toFixed(6),
  };
}

function signature(pose: ReturnType<StateDef['pose']>): string {
  return JSON.stringify([
    pose.gaze,
    pose.split,
    pose.eyes,
    pose.sil.rot,
    pose.sil.cx,
    pose.sil.cy,
    pose.sil.sx,
    pose.sil.sy,
  ]);
}

function buildProbes(state: StateDef, radii: number[], expression: Expression | null): Probe[] {
  const probes: Probe[] = [];
  const times =
    signature(state.pose(0)) === signature(state.pose(state.duration))
      ? [0]
      : Array.from({ length: 3 }, (_, i) => (i / 2) * state.duration);
  for (const sampleT of times) {
    const pose = state.pose(sampleT);
    const outline = rasterizeSilhouette({ ...pose.sil, radii }, 100);
    const poseOutline = rasterizeSilhouette(pose.sil, 100);
    const source =
      state.baseFace && expression
        ? { gaze: expression.gaze, split: expression.split, eyes: expression.eyes }
        : { gaze: pose.gaze, split: pose.split, eyes: pose.eyes };
    const looks: LookSample[] = [];
    for (const dx of [-7.1, 7.1]) {
      for (const dy of [-5.5, 5.5]) {
        looks.push({
          ...source,
          gaze: {
            yaw: source.gaze.yaw + dx,
            pitch: source.gaze.pitch + dy,
            roll: source.gaze.roll,
          },
        });
      }
    }
    for (const look of looks) {
      probes.push({
        footprints: eyeFootprints(look, pose.sil, radii),
        referenceFootprints: eyeFootprints(look, pose.sil, pose.sil.radii),
        outline,
        poseOutline,
      });
    }
  }
  return probes;
}

const key = (stateId: string, expressionId: string | null): string =>
  `${stateId}|${expressionId ?? ''}`;

let shapeRadii: Set<number[]> | null = null;
const shapeTables = new Map<number[], Map<string, Point>>();

/** Build one shape's table on first use. Lazy so importing the package is cheap. */
function tableFor(radii: number[]): Map<string, Point> | null {
  if (!shapeRadii) shapeRadii = new Set(SHAPES.map((shape) => shape.radii));
  if (!shapeRadii.has(radii)) return null;
  let table = shapeTables.get(radii);
  if (table) return table;
  table = new Map<string, Point>();
  for (const state of STATES) {
    if (!state.baseBody) continue;
    const expressions: (Expression | null)[] = state.baseFace ? [null, ...EXPRESSIONS] : [null];
    for (const expression of expressions) {
      table.set(
        key(state.id, expression?.id ?? null),
        solve(buildProbes(state, radii, expression)),
      );
    }
  }
  shapeTables.set(radii, table);
  return table;
}

/** Eye clearance offset for a shape (by radii identity), state and face. */
export function eyeClearanceOffsetFor(
  radii: number[] | null,
  stateId: string,
  expressionId: string | null,
): Point {
  if (!radii) return EMPTY;
  const table = tableFor(radii);
  return table?.get(key(stateId, expressionId)) ?? table?.get(key(stateId, null)) ?? EMPTY;
}
