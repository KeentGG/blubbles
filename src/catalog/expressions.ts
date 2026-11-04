// Expression catalog: the sixteen faces, their gaze/eye geometry, and the blend
// used while morphing between two faces.
import { lerp } from '../math/index.js';
import type { Expression, ExpressionId, EyeShape, Gaze } from '../types.js';

/** The engine's resting gaze, shared by the neutral face and the idle pose. */
export const DEFAULT_GAZE: Gaze = { yaw: 28.49, pitch: 28.62, roll: -13 };

function eye(w: number, h: number, tilt = 0, open = 1): EyeShape {
  return { w, h, tilt, open };
}

function mirror(w: number, h: number, tilt = 0, open = 1): [EyeShape, EyeShape] {
  return [eye(w, h, tilt, open), eye(w, h, -tilt, open)];
}

export const EXPRESSIONS: Expression[] = [
  {
    id: 'neutral',
    gaze: { ...DEFAULT_GAZE },
    split: 15.46,
    eyes: [eye(0.186, 0.412), eye(0.186, 0.412)],
  },
  {
    id: 'attentive',
    gaze: { yaw: 4, pitch: 5, roll: -4 },
    split: 16,
    eyes: mirror(0.21, 0.44),
  },
  {
    id: 'surprised',
    gaze: { yaw: 3, pitch: -3, roll: 0 },
    split: 19,
    eyes: mirror(0.45, 0.47),
  },
  {
    id: 'excited',
    gaze: { yaw: 6, pitch: -14, roll: 0 },
    split: 19.5,
    eyes: mirror(0.4, 0.56, -10),
  },
  {
    id: 'happy',
    gaze: { yaw: 5, pitch: 9, roll: 0 },
    split: 17,
    eyes: mirror(0.27, 0.17, 14),
  },
  {
    id: 'laughing',
    gaze: { yaw: 4, pitch: 14, roll: 0 },
    split: 18,
    eyes: mirror(0.34, 0.13, 20),
  },
  {
    id: 'angry',
    gaze: { yaw: 3, pitch: 7, roll: 0 },
    split: 17,
    eyes: mirror(0.34, 0.15, 30),
  },
  {
    id: 'sad',
    gaze: { yaw: 3, pitch: -13, roll: 0 },
    split: 16,
    eyes: mirror(0.22, 0.4, -28),
  },
  {
    id: 'scared',
    gaze: { yaw: 2, pitch: -20, roll: 0 },
    split: 20.5,
    eyes: mirror(0.4, 0.6),
  },
  {
    id: 'suspicious',
    gaze: { yaw: 12, pitch: 6, roll: -6 },
    split: 16,
    eyes: [eye(0.21, 0.4), eye(0.22, 0.15)],
  },
  {
    id: 'confused',
    gaze: { yaw: -14, pitch: 3, roll: 8 },
    split: 16.5,
    eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)],
  },
  {
    id: 'curious',
    gaze: { yaw: 16, pitch: -9, roll: -15 },
    split: 16.5,
    eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)],
  },
  {
    id: 'proud',
    gaze: { yaw: 5, pitch: 17, roll: 0 },
    split: 17,
    eyes: mirror(0.3, 0.15, 18),
  },
  {
    id: 'shy',
    gaze: { yaw: -19, pitch: -14, roll: -7 },
    split: 14,
    eyes: mirror(0.17, 0.3),
  },
  {
    id: 'unimpressed',
    gaze: { yaw: -22, pitch: 2, roll: 0 },
    split: 16,
    eyes: mirror(0.3, 0.12),
  },
  {
    id: 'sleepy',
    gaze: { yaw: 6, pitch: -9, roll: -3 },
    split: 16,
    eyes: mirror(0.2, 0.42, 0, 0.42),
  },
];

export const EXPRESSION_BY_ID = new Map<string, Expression>(
  EXPRESSIONS.map((expression) => [expression.id, expression]),
);

function blendEye(from: EyeShape, to: EyeShape, k: number): EyeShape {
  return {
    w: lerp(from.w, to.w, k),
    h: lerp(from.h, to.h, k),
    tilt: lerp(from.tilt ?? 0, to.tilt ?? 0, k),
    open: lerp(from.open, to.open, k),
  };
}

/** Blend two expressions; the result keeps the target's id. */
export function blendExpression(from: Expression, to: Expression, k: number): Expression {
  return {
    id: to.id,
    gaze: {
      yaw: lerp(from.gaze.yaw, to.gaze.yaw, k),
      pitch: lerp(from.gaze.pitch, to.gaze.pitch, k),
      roll: lerp(from.gaze.roll, to.gaze.roll, k),
    },
    split: lerp(from.split, to.split, k),
    eyes: [blendEye(from.eyes[0], to.eyes[0], k), blendEye(from.eyes[1], to.eyes[1], k)],
  };
}

export type { ExpressionId };
