// Raw layer: a DOM-free engine plus a one-call SVG helper for Node, SSR and stills.
// Import it as `blubbles/engine`.
import { normalizeAccessories } from './sdk/accessories.js';
import type { AccessoryInput } from './sdk/accessories.js';
import { EXPRESSION_BY_ID, SHAPE_BY_ID, BlubEngine } from './engine/index.js';
import { autoEye, renderSVG } from './render/svg.js';
import { colorHex, requireColor, requireFace, requireShape } from './resolve.js';
import { normalizeClay } from './sdk/clay.js';
import type { ClayOptions } from './sdk/clay.js';
import {
  ACTION_STATES,
  STATUS_STATES,
  requireAction,
  requireFinish,
  requireStatus,
} from './sdk/commands.js';
import type { Action, Color, Face, Finish, Shape, Status } from './sdk/commands.js';

export interface RenderBlubSVGOptions {
  shape?: Shape;
  face?: Face;
  color?: Color;
  finish?: Finish;
  /** What it wears, such as `['hat', 'tie']`. */
  accessories?: readonly AccessoryInput[];
  /** Clay intensity: number shorthand or { highlight, shadow, light }. */
  clay?: number | ClayOptions;
  /** One-shot action to pose. Takes precedence over status. */
  action?: Action;
  /** Looping status to pose. Default 'idle'. */
  status?: Status;
  /** Seconds since the action/status started. Default 0. */
  time?: number;
  /** Output size in pixels. Default 512. */
  size?: number;
  paper?: string;
  eye?: string | null;
  background?: string | null;
  uid?: string;
}

/** FNV-1a: a short, stable label for a string. Not a security hash. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Render one blub frame to an SVG string. No DOM, no clock, no listeners:
 * `renderBlubSVG({ shape: 'pebble', face: 'happy', color: 'blue' })`.
 */
export function renderBlubSVG(options: RenderBlubSVGOptions = {}): string {
  const shape = requireShape(options.shape ?? 'circle');
  const face = requireFace(options.face ?? 'happy');
  const color = requireColor(options.color ?? 'blue');
  const finish = requireFinish(options.finish ?? 'clay');
  const clay = normalizeClay(options.clay);
  const state = options.action
    ? ACTION_STATES[requireAction(options.action)]
    : STATUS_STATES[requireStatus(options.status ?? 'idle')];
  const time = options.time ?? 0;
  if (!Number.isFinite(time) || time < 0) {
    throw new TypeError('renderBlubSVG time must be a finite, non-negative number of seconds.');
  }
  const size = options.size ?? 512;
  if (!Number.isFinite(size) || size <= 0) {
    throw new TypeError('renderBlubSVG size must be a positive number.');
  }

  const body = colorHex(color);
  const background = options.background ?? null;
  const paper = options.paper ?? background ?? autoEye(body);
  const engine = new BlubEngine(100, state, SHAPE_BY_ID.get(shape)!.radii, EXPRESSION_BY_ID.get(face)!);
  engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
  if (options.accessories !== undefined) {
    engine.setAccessories(normalizeAccessories(options.accessories), 0, true);
  }
  const sample = engine.sample(time);
  // Without a uid, ids come from what is drawn: inline SVGs share one id space, so two
  // different blubs must not collide, and two identical ones may share safely.
  const wear = options.accessories === undefined ? [] : normalizeAccessories(options.accessories);
  const uid =
    options.uid ??
    `blub-${hashText(JSON.stringify([shape, face, body, finish, clay, state, time, size, paper, options.eye ?? null, background, wear]))}`;
  return renderSVG(sample, {
    color: body,
    size,
    crop: 124,
    scale: 158,
    paper,
    eye: options.eye ?? null,
    clay: finish === 'clay',
    clayHighlight: clay.highlight,
    clayShadow: clay.shadow,
    clayLight: clay.light,
    uid,
    background,
  });
}

export { BlubEngine, accessoryPartColor } from './engine/index.js';
export { renderSVG as renderSampleSVG } from './render/svg.js';
export { autoEye, PAPER, INK, CREAM, NOTIF_BLUE } from './render/svg.js';
export {
  SHAPES,
  SHAPE_BY_ID,
  EXPRESSIONS,
  EXPRESSION_BY_ID,
  STATES,
  STATE_BY_ID,
  POSES,
  RINGS,
  SWOOSH,
  particles,
  arcRender,
  TAU,
  clamp,
  lerp,
  loopNoise,
  easings,
  mixHex,
  RAYON,
} from './engine/index.js';
export type { BlubSample } from './types.js';
export type { ArcSeed, ArcSpec, DotSpec, EyeShape, Gaze, Look, Pose, Silhouette } from './types.js';
