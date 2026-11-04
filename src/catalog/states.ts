// State catalog: the fifteen poses (idle, wink, ... comet) and the per-pose
// decorations they attach. Every pose returns a full Pose; the engine blends them.
import { arcPolygon, polygonPath, raycastRadii } from '../geometry/silhouette.js';
import { TAU, clamp, easings } from '../math/index.js';
import { circleShape, shapeFromBase, silhouetteFromRadii } from './shapes.js';
import { DEFAULT_GAZE } from './expressions.js';
import { COMET_RIBBONS, RINGS, SWOOSH, particles } from '../engine/arcs.js';
import type { DotSpec, EyeShape, Pose, Silhouette, StateDef, StateId } from '../types.js';

/** Horizontal slots for the three thinking dots. */
const DOT_X = [-0.557, -0.013, 0.532];

function twoEyes(w: number, h: number): [EyeShape, EyeShape] {
  return [
    { w, h, open: 1 },
    { w, h, open: 1 },
  ];
}

/** The base pose every state starts from, before its overrides. */
function defaultPose(overrides: Partial<Pose> = {}): Pose {
  return {
    sil: circleShape(1),
    offX: 0,
    offY: 0,
    gaze: { ...DEFAULT_GAZE },
    split: 15.46,
    eyes: twoEyes(0.186, 0.412),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: false,
    ...overrides,
  };
}

function cached<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) value = build();
    return value;
  };
}

const exclaimRadii = cached(() =>
  raycastRadii(arcPolygon(0, -0.505, 0.132, 0, 0.13, 0.075), 0, -0.1875),
);
const alertRadii = cached(() =>
  raycastRadii(arcPolygon(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0),
);
const exclaimMark = cached(() => polygonPath(arcPolygon(0, 0, 0.118, 0, 0.172, 0.012)));

/** Triangle silhouette rotated around the body centre (play and orbit). */
function rotatedTriangle(rotation: number): Silhouette {
  return shapeFromBase('triangle', {
    rot: rotation,
    cx: -0.213 * Math.sin(rotation),
    cy: 0.213 * Math.cos(rotation),
  });
}

/** A 1.5 s cosine wave, phase-shifted per dot, used by the thinking pose. */
function blinkPhase(t: number, offset: number): number {
  const phase = ((((t - 0.5 * offset) / 1.5) % 1) + 1) % 1;
  return clamp(2 * (phase < 0.5 ? 0.5 - 0.5 * Math.cos(phase * TAU) : 0));
}

export const POSES: Record<StateId, number> = {
  idle: 1,
  thinking: 1.1,
  wink: 0.8,
  wide: 0.8,
  alert: 0.75,
  notify: 0.9,
  exclaim: 0.8,
  sleep: 0.45,
  egg: 0.8,
  hexagon: 0.8,
  play: 0.9,
  orbit: 1.2,
  swirl: 0.5,
  burst: 0.45,
  comet: 1.15,
};

export const STATES: StateDef[] = [
  {
    id: 'idle',
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    pose: () => defaultPose(),
  },
  {
    id: 'thinking',
    duration: 2.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      const phase = blinkPhase(t, 1);
      const fade = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3));
      return defaultPose({
        sil: circleShape(0.165 * (1 + 0.25 * phase), { cx: DOT_X[1] }),
        eyeAlpha: 0,
        dots: [0, 2].map((index) => {
          const dotPhase = blinkPhase(t, index);
          return {
            x: DOT_X[index] * fade,
            y: 0,
            r: 0.165 * (1 + 0.25 * dotPhase),
            opacity: 0.55 + 0.45 * dotPhase,
          };
        }),
      });
    },
  },
  {
    id: 'wink',
    duration: 1.6,
    morph: 0.3,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      defaultPose({
        gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
        split: 16.25,
        eyes: [
          { w: 0.236, h: 0.464, open: 1 },
          { w: 0.447, h: 0.089, open: 1 },
        ],
      }),
  },
  {
    id: 'wide',
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      defaultPose({
        gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
        split: 18.43,
        eyes: twoEyes(0.356, 0.875),
      }),
  },
  {
    id: 'alert',
    duration: 2.4,
    minDuration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const progress = clamp(t / 1.5);
      const travel = 0.82 * easings.easeInOutCubic(progress) - 0.087;
      const settle = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
      const shift = travel * (1 - settle) + 0.1 * settle;
      const bob = 0.005 * Math.sin(2.5 * t * TAU);
      const angle = (17.7 * Math.PI) / 180;
      return defaultPose({
        sil: silhouetteFromRadii(alertRadii(), {
          rot: angle,
          cx: shift,
          cy: -0.325 - bob,
        }),
        eyeAlpha: 0,
        dots: [
          {
            x: shift - 0.58 * Math.sin(angle),
            y: -0.325 + 0.58 * Math.cos(angle) + 2.8 * bob,
            r: 0.118,
            d: exclaimMark(),
            rot: (180 * angle) / Math.PI,
            opacity: 1,
          },
        ],
      });
    },
  },
  {
    id: 'notify',
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: (t) => {
      const progress = clamp(t / 0.45);
      const pop = 1 + (1.14 - 1) * Math.sin(progress * Math.PI) * (1 - 0.35 * progress);
      const radius = 0.15 * (progress < 1 ? pop : 1);
      const angle = (-42 * Math.PI) / 180;
      return defaultPose({
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: twoEyes(0.505, 0.498),
        notif: {
          x: 1.003 * Math.cos(angle),
          y: 1.003 * Math.sin(angle),
          r: radius,
          notch: radius + 0.054,
        },
      });
    },
  },
  {
    id: 'exclaim',
    duration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: () =>
      defaultPose({
        sil: silhouetteFromRadii(exclaimRadii(), { cy: -0.1875 }),
        eyeAlpha: 0,
        dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }],
      }),
  },
  {
    id: 'sleep',
    duration: 2.4,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) =>
      defaultPose({
        sil: circleShape(0.1585, { cy: 0.11 + 0.19 * Math.sin((TAU / 0.6) * t) }),
        eyeAlpha: 0,
      }),
  },
  {
    id: 'egg',
    duration: 1.8,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      defaultPose({
        sil: shapeFromBase('egg'),
        gaze: { yaw: 19.97, pitch: 26.01, roll: -17.1 },
        split: 11.07,
        eyes: twoEyes(0.164, 0.385),
      }),
  },
  {
    id: 'hexagon',
    duration: 1.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      defaultPose({
        sil: shapeFromBase('hexagon'),
        gaze: { yaw: 23.11, pitch: 24.42, roll: -13.3 },
        split: 13.37,
        eyes: twoEyes(0.177, 0.411),
      }),
  },
  {
    id: 'play',
    duration: 2,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      const opacity = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
      return defaultPose({
        sil: rotatedTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: twoEyes(0.18, 0.34),
        arcs: SWOOSH.map((seed, i) => ({
          id: `sw${i}`,
          seed: { ...seed, cx: 0.45 - 0.42 * t },
          t,
          opacity,
        })),
      });
    },
  },
  {
    id: 'orbit',
    duration: 3.4,
    minDuration: 2.5,
    morph: 0.6,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const spinIn = easings.easeInOutCubic(clamp(t / 0.35));
      const rotation = -(1.25 * TAU) * t * spinIn;
      const settle = easings.easeInOutCubic(clamp((t - 1.6) / 0.9));
      const triangle = rotatedTriangle(rotation);
      const circle = circleShape(1, { rot: rotation });
      const sil: Silhouette = {
        radii: triangle.radii.map((radius, i) => radius + (circle.radii[i] - radius) * settle),
        rot: rotation,
        cx: triangle.cx * (1 - settle),
        cy: triangle.cy * (1 - settle),
        sx: 1,
        sy: 1,
      };
      const opacity = clamp(t / 0.8) * clamp((3.6 - t) / 0.9);
      return defaultPose({
        sil,
        gaze: {
          yaw: DEFAULT_GAZE.yaw + 65 * Math.sin(6.5 * t) * (1 - settle),
          pitch: -4 + 32 * settle,
          roll: -13,
        },
        eyes: twoEyes(0.18, 0.34 + 0.07 * settle),
        arcs: RINGS.map((seed, i) => ({
          id: `rg${i}`,
          seed,
          t,
          opacity: opacity * clamp((t - 0.13 * i) / 0.3),
        })),
      });
    },
  },
  {
    id: 'swirl',
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    baseFace: true,
    baseBody: true,
    blinkIn: true,
    pose: (t) =>
      defaultPose({
        arcs: RINGS.slice(0, 3).map((seed, i) => ({
          id: `sw${i}`,
          seed,
          t,
          opacity: clamp((t - 0.06 * i) / 0.14) * clamp((1.22 - t) / 0.34),
        })),
      }),
  },
  {
    id: 'burst',
    duration: 2.6,
    minDuration: 2.4,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const shrink = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7));
      return defaultPose({
        sil: circleShape(shrink + (1 - shrink) * easings.easeOutQuint(clamp((t - 1.7) / 0.7))),
        eyeAlpha: clamp((t - 1.85) / 0.4),
        dots: particles(t, 1),
        dotsBehind: true,
      });
    },
  },
  {
    id: 'comet',
    duration: 2.4,
    minDuration: 2.4,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const shrink = 1 - 0.871 * easings.easeOutQuint(clamp(t / 0.55));
      const grow = easings.easeOutQuint(clamp((t - 1.85) / 0.6));
      const opacity = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3);
      return defaultPose({
        sil: circleShape(shrink + (1 - shrink) * grow, {
          cy: 0.035 * Math.sin(clamp(t / 1.7) * Math.PI),
        }),
        eyeAlpha: clamp((t - 2) / 0.35),
        arcs: COMET_RIBBONS.map((seed, i) => ({ id: `cm${i}`, seed, t, opacity })),
      });
    },
  },
];

export const STATE_BY_ID = new Map<string, StateDef>(STATES.map((state) => [state.id, state]));

export type { DotSpec };
