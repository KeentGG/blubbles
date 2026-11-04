// BlubEngine: the state machine and morph clocks. It composes the modules above
// into a single `sample(t)` and re-exports the engine-level API.
import { clamp, easings, lerp } from '../math/index.js';
import { STATE_BY_ID } from '../catalog/states.js';
import { blendExpression } from '../catalog/expressions.js';
import {
  ACCESSORIES,
  ACCESSORY_OFF,
  ACCESSORY_ON,
  SPRING_TAPS,
  eyesBottom,
  mustacheFitFor,
  mustacheSpace,
  sampleAccessory,
} from './accessories.js';
import type {
  AccessoryId,
  AccessoryLife,
  AccessoryRig,
  AccessorySwing,
  AccessoryWear,
  FaceFrame,
} from './accessories.js';
import { ambientMotion } from './ambient.js';
import { bodyPathFor } from './body.js';
import { eyeClearanceOffsetFor } from './eye-clearance.js';
import { faceFrame, sampleArcs, sampleDots, sampleEyes, sampleNotif } from './decorations.js';
import { blendPose } from './morph.js';
import type {
  BlubSample,
  Expression,
  EyeSample,
  Gaze,
  Look,
  Point,
  Pose,
  StateDef,
  StateId,
} from '../types.js';

/** Body scale unit. Samples are computed in this unit and scaled by renderers. */
export const RAYON = 100;

/** Ambient motion zeroed: reduced-motion rendering keeps actions but freezes the idle. */
const NEUTRAL_MOTION = {
  dYaw: 0,
  dPitch: 0,
  dRoll: 0,
  lid: 1,
  driftX: 0,
  driftY: 0,
  breath: 1,
};

/** The engine's resting look: no pointer target, ambient wander on. */
const DEFAULT_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };

export class BlubEngine {
  static SHAPE_MORPH = 0.45;
  static LOOK_MORPH = 0.24;

  readonly scale: number;
  private cur: StateId;
  private prev: StateId | null = null;
  private frozenDeparture: Pose | null = null;
  private tCur = 0;
  private tPrev = 0;
  private blinkAt = -10;
  private readonly pts: Point[] = [];
  private shape: number[] | null = null;
  private shapePrev: number[] | null = null;
  private shapeAt = -10;
  private expr: Expression | null = null;
  private exprPrev: Expression | null = null;
  private exprAt = -10;
  private look: Look = DEFAULT_LOOK;
  private lookPrev: Look = DEFAULT_LOOK;
  private lookAt = -10;
  private lookMorph = BlubEngine.LOOK_MORPH;
  private worn: { id: AccessoryId; color: string | null; on: number; off: number | null }[] = [];

  constructor(
    scale = 100,
    state: StateId = 'idle',
    shape: number[] | null = null,
    expression: Expression | null = null,
  ) {
    this.scale = scale;
    this.cur = state;
    this.shape = shape;
    this.expr = expression;
  }

  get state(): StateId {
    return this.cur;
  }

  setExpression(expression: Expression | null, t = 0): void {
    if (expression !== this.expr) {
      this.exprPrev = this.expr;
      this.expr = expression;
      this.exprAt = t;
    }
  }

  exprAtTime(t: number): Expression | null {
    const current = this.expr;
    const previous = this.exprPrev;
    if (!current || !previous) return current;
    const k = (t - this.exprAt) / BlubEngine.SHAPE_MORPH;
    return k >= 1
      ? current
      : blendExpression(previous, current, easings.easeOutQuint(clamp(k)));
  }

  setShape(radii: number[] | null, t = 0): void {
    if (radii !== this.shape) {
      this.shapePrev = this.shape;
      this.shape = radii;
      this.shapeAt = t;
    }
  }

  shapeAtTime(t: number): number[] | null {
    const current = this.shape;
    const previous = this.shapePrev;
    if (!current || !previous) return current;
    const k = (t - this.shapeAt) / BlubEngine.SHAPE_MORPH;
    if (k >= 1) return current;
    const eased = easings.easeOutQuint(clamp(k));
    return current.map((radius, i) => lerp(previous[i] ?? radius, radius, eased));
  }

  setLook(look: Look | null, t = 0, morph = BlubEngine.LOOK_MORPH): void {
    if (!look || Number.isFinite(look.yaw + look.pitch + look.mix + look.spin + look.wander)) {
      this.lookPrev = this.lookAtTime(t);
      this.look = look ?? DEFAULT_LOOK;
      this.lookAt = t;
      this.lookMorph = morph;
    }
  }

  lookAtTime(t: number): Look {
    const k = (t - this.lookAt) / this.lookMorph;
    if (k >= 1) return this.look;
    const from = this.lookPrev;
    const to = this.look;
    const eased = easings.easeOutQuint(clamp(k));
    return {
      yaw: lerp(from.yaw, to.yaw, eased),
      pitch: lerp(from.pitch, to.pitch, eased),
      mix: lerp(from.mix, to.mix, eased),
      spin: lerp(from.spin, to.spin, eased),
      wander: lerp(from.wander, to.wander, eased),
    };
  }

  private posed(
    state: StateDef,
    t: number,
    radii: number[] | null,
    expression: Expression | null,
  ): Pose {
    let pose = state.pose(t);
    if (state.baseBody && radii) pose = { ...pose, sil: { ...pose.sil, radii } };
    if (state.baseFace && expression) {
      pose = { ...pose, gaze: expression.gaze, split: expression.split, eyes: expression.eyes };
    }
    return pose;
  }

  private clearanceOffsetAtTime(t: number, stateId: StateId): Point {
    const shift = (at: number, morph: number, from: Point, to: Point): Point => {
      if (from === to) return to;
      const k = (t - at) / morph;
      if (k >= 1) return to;
      const eased = easings.easeOutQuint(clamp(k));
      return { x: lerp(from.x, to.x, eased), y: lerp(from.y, to.y, eased) };
    };
    const byExpression = (radii: number[] | null): Point =>
      shift(
        this.exprAt,
        BlubEngine.SHAPE_MORPH,
        eyeClearanceOffsetFor(radii, stateId, this.exprPrev?.id ?? null),
        eyeClearanceOffsetFor(radii, stateId, this.expr?.id ?? null),
      );
    return shift(
      this.shapeAt,
      BlubEngine.SHAPE_MORPH,
      byExpression(this.shapePrev),
      byExpression(this.shape),
    );
  }

  private departurePose(
    t: number,
    radii: number[] | null,
    expression: Expression | null,
  ): Pose | null {
    if (this.frozenDeparture) return this.frozenDeparture;
    if (!this.prev) return null;
    const state = STATE_BY_ID.get(this.prev)!;
    return this.posed(state, Math.max(0, t - this.tPrev), radii, expression);
  }

  private composedPose(t: number): Pose {
    const state = STATE_BY_ID.get(this.cur)!;
    const radii = this.shapeAtTime(t);
    const expression = this.exprAtTime(t);
    const current = this.posed(state, Math.max(0, t - this.tCur), radii, expression);
    const elapsed = t - this.tCur;
    if (elapsed >= state.morph) return current;
    const previous = this.departurePose(t, radii, expression);
    return previous
      ? blendPose(previous, current, easings.easeOutQuint(clamp(elapsed / state.morph)))
      : current;
  }

  setState(state: StateId, t: number): void {
    if (state === this.cur) return;
    const morph = STATE_BY_ID.get(this.cur)!.morph;
    const interrupted = this.prev !== null && t - this.tCur < morph;
    this.frozenDeparture = interrupted ? this.composedPose(t) : null;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = state;
    this.tCur = t;
    if (STATE_BY_ID.get(state)?.blinkIn) this.blinkAt = t;
  }

  reset(state: StateId, t: number): void {
    this.cur = state;
    this.prev = null;
    this.frozenDeparture = null;
    this.tCur = t;
    this.tPrev = t;
    this.blinkAt = -10;
  }

  /**
   * What the blub is wearing. A newly worn thing arrives from time `t`, a removed one
   * leaves from `t`, and passing `instant` skips both, for stills and reduced motion.
   */
  setAccessories(wear: readonly AccessoryWear[], t = 0, instant = false): void {
    const slotOf = (id: AccessoryId): string | undefined =>
      ACCESSORIES.find((item) => item.id === id)?.slot;
    const bySlot = new Map(wear.map((item) => [slotOf(item.id), item]));
    const next: typeof this.worn = [];
    for (const entry of this.worn) {
      if (entry.off !== null && t - entry.off >= ACCESSORY_OFF) continue;
      const wanted = bySlot.get(slotOf(entry.id));
      if (entry.off === null && wanted?.id === entry.id) {
        next.push({ ...entry, color: wanted.color });
        bySlot.delete(slotOf(entry.id));
      } else if (!instant) {
        next.push(entry.off === null ? { ...entry, off: t } : entry);
      }
    }
    for (const item of bySlot.values()) {
      next.push({ id: item.id, color: item.color, on: instant ? -10 : t, off: null });
    }
    this.worn = next;
  }

  private rigAt(t: number, ambient: boolean): AccessoryRig {
    const pose = this.composedPose(t);
    const motion = ambient ? ambientMotion(t, { wander: pose.eyeAlpha > 0.01 ? 1 : 0 }) : NEUTRAL_MOTION;
    const look = this.lookAtTime(t);
    return {
      sil: { ...pose.sil, sy: pose.sil.sy * motion.breath },
      x: pose.offX + motion.driftX,
      y: pose.offY + motion.driftY,
      gaze: {
        yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + motion.dYaw * look.wander - look.spin,
        pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + motion.dPitch * look.wander,
        roll: pose.gaze.roll + motion.dRoll * look.wander,
      },
      brow: Math.max(pose.eyes[0].h, pose.eyes[1].h),
      alpha: pose.bodyAlpha,
    };
  }

  private sampleWorn(
    t: number,
    ambient: boolean,
    eyeBottom: number | null,
    face: FaceFrame | null,
  ): BlubSample['accessories'] {
    const rig: AccessoryRig = { ...this.rigAt(t, ambient), eyeBottom, face };
    const size = (r: AccessoryRig): number => (r.sil.radii[0] ?? 1) * r.sil.sx;
    const swing: AccessorySwing = { x: 0, y: 0, yaw: 0, pitch: 0, size: 0 };
    for (const tap of SPRING_TAPS) {
      const past = this.rigAt(t - tap.delay, ambient);
      swing.x += tap.weight * (rig.sil.cx + rig.x - past.sil.cx - past.x);
      swing.y += tap.weight * (rig.sil.cy + rig.y - past.sil.cy - past.y);
      swing.yaw += tap.weight * (rig.gaze.yaw - past.gaze.yaw);
      swing.pitch += tap.weight * (rig.gaze.pitch - past.gaze.pitch);
      swing.size += tap.weight * (size(rig) - size(past));
    }
    const lifeOf = (entry: (typeof this.worn)[number]): AccessoryLife => ({
      on: t - entry.on,
      off: entry.off === null ? null : t - entry.off,
    });
    const showing = this.worn.filter((entry) => entry.off === null || t - entry.off < ACCESSORY_OFF);
    // A mustache takes the space under the eyes, so neck pieces fit below it.
    const lip = showing.find((entry) => entry.id === 'mustache');
    const bow = showing.find((entry) => entry.id === 'bowtie');
    if (lip && bow) {
      const arrived = clamp((t - bow.on) / ACCESSORY_ON) * (bow.off === null ? 1 : 1 - clamp((t - bow.off) / ACCESSORY_OFF));
      rig.lipFit = mustacheFitFor(rig, arrived, this.scale);
    }
    const neckRig: AccessoryRig =
      lip && eyeBottom !== null
        ? { ...rig, eyeBottom: eyeBottom + mustacheSpace(rig, lifeOf(lip), this.scale) }
        : rig;
    return showing.map((entry) =>
      sampleAccessory(
        entry.id,
        entry.id === 'mustache' ? rig : neckRig,
        swing,
        lifeOf(entry),
        this.scale,
        entry.color,
      ),
    );
  }

  sample(t: number, ambient = true): BlubSample {
    const scale = this.scale;
    const state = STATE_BY_ID.get(this.cur)!;
    const radii = this.shapeAtTime(t);
    const expression = this.exprAtTime(t);
    let pose = this.posed(state, Math.max(0, t - this.tCur), radii, expression);
    let clearanceOffset = this.clearanceOffsetAtTime(t, this.cur);
    const elapsed = t - this.tCur;
    const previous = elapsed < state.morph ? this.departurePose(t, radii, expression) : null;
    if (previous) {
      const weight = easings.easeOutQuint(clamp(elapsed / state.morph));
      pose = blendPose(previous, pose, weight);
      const previousState = this.prev;
      if (previousState) {
        const previousClearanceOffset = this.clearanceOffsetAtTime(t, previousState);
        clearanceOffset = {
          x: lerp(previousClearanceOffset.x, clearanceOffset.x, weight),
          y: lerp(previousClearanceOffset.y, clearanceOffset.y, weight),
        };
      }
    }

    const eyesVisible = pose.eyeAlpha > 0.01;
    const look = this.lookAtTime(t);
    const motion = ambient
      ? ambientMotion(t, { wander: eyesVisible ? look.wander : 0, blink: eyesVisible })
      : NEUTRAL_MOTION;
    const gaze: Gaze = {
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + motion.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + motion.dPitch,
      roll: pose.gaze.roll + motion.dRoll,
    };
    const blinkPhase = clamp((t - this.blinkAt) / 0.2);
    const blinkClose = blinkPhase < 1 ? Math.abs(2 * blinkPhase - 1) : 1;
    const lid = Math.min(motion.lid, blinkClose);
    const offsetX = pose.offX + motion.driftX;
    const offsetY = pose.offY + motion.driftY;

    const bodyPath = bodyPathFor(pose, offsetX, offsetY, motion.breath, scale, this.pts);
    const eyes: EyeSample[] = sampleEyes(pose, gaze, scale, lid, offsetX, offsetY, clearanceOffset);
    const dots = sampleDots(pose.dots, offsetX, offsetY, scale);
    const { notif, notch } = sampleNotif(pose, offsetX, offsetY, scale);

    const sample: BlubSample = {
      bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes,
      dots,
      dotsBehind: pose.dotsBehind,
      arcs: sampleArcs(pose.arcs, scale),
      notif,
      notch,
    };
    if (this.worn.length > 0) {
      const open = sampleEyes(pose, gaze, scale, 1, offsetX, offsetY, clearanceOffset);
      sample.accessories = this.sampleWorn(
        t,
        ambient,
        eyesBottom(open),
        faceFrame(pose, gaze, scale, offsetX, offsetY, clearanceOffset),
      );
    }
    return sample;
  }
}

// Engine-level API, kept under the original public names.
export { TAU, clamp, lerp, loopNoise, easings, mixHex } from '../math/index.js';
export { STATES, STATE_BY_ID, POSES } from '../catalog/states.js';
export { SHAPES, SHAPE_BY_ID } from '../catalog/shapes.js';
export { COLORS, COLOR_BY_ID } from '../catalog/colors.js';
export { EXPRESSIONS, EXPRESSION_BY_ID, blendExpression } from '../catalog/expressions.js';
export { RINGS, SWOOSH, particles, arcRender } from './arcs.js';
export { ACCESSORIES, accessoryAutoColor, accessoryClayStops, accessoryPartColor } from './accessories.js';
export type { AccessoryId, AccessorySlot, AccessoryWear } from './accessories.js';
export type {
  AccessoryPart,
  AccessorySample,
  ArcSeed,
  ArcSpec,
  BlubSample,
  CircleSample,
  DotSpec,
  Expression,
  EyeSample,
  EyeShape,
  Gaze,
  Look,
  NotifSpec,
  Point,
  Pose,
  RenderDot,
  RenderedArc,
  ShapeId,
  Silhouette,
  StateDef,
  StateId,
} from '../types.js';
