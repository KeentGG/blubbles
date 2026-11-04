// createBlubModel: one blub, one style and one engine clock. The setters keep the
// public names (English/engine ids/hex) in sync with the engine values.
import { BlubEngine, EXPRESSION_BY_ID, SHAPE_BY_ID } from '../engine/index.js';
import type { AccessoryWear } from '../engine/index.js';
import { colorHex, requireAction, requireFace, requireShape } from '../resolve.js';
import { autoEye } from '../palette.js';
import type { BlubSample, Expression, Look, StateId } from '../types.js';

/** The engine's resting gaze: no pointer target, ambient wander on. */
export const IDLE_LOOK: Look = { yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 };

export type BlubModelFinish = 'clay' | 'flat';

export interface BlubModelLookTarget {
  yaw: number;
  pitch: number;
}

export interface BlubModelOptions {
  /** Public shape name. Default 'circle'. */
  shape?: string;
  /** Public face name. Default 'neutral'. */
  face?: string;
  /** Colour name, engine colour id, or `#rrggbb`. Default 'blue'. */
  color?: string;
  /** Default 'clay'. */
  finish?: BlubModelFinish | (string & {});
  /** Paper / body-underfill colour. Defaults to autoEye(color). */
  paper?: string;
  /** Eye cut-out colour. 'auto' picks contrast against the body. */
  eye?: 'auto' | (string & {});
  /** Initial action. Default 'idle'. */
  action?: string;
  /** Ambient motion (wander, blink, drift, breath). Default true. */
  ambient?: boolean;
}

export interface BlubModel {
  setShape(name: string, t?: number): void;
  setFace(name: string, t?: number): void;
  setColor(value: string): void;
  setFinish(value: string): void;
  setAmbient(enabled: boolean): void;
  setAccessories(wear: readonly AccessoryWear[], t?: number, instant?: boolean): void;
  play(name: string, t?: number, opts?: { restart?: boolean }): void;
  /** `null` returns to the engine's idle wander. */
  look(target: BlubModelLookTarget | null, t?: number, morph?: number): void;
  sample(t: number): BlubSample;
  readonly accessories: readonly AccessoryWear[];
  readonly state: StateId;
  readonly shape: string;
  readonly face: string;
  readonly color: string;
  readonly finish: BlubModelFinish;
  readonly paper: string;
  readonly eye: string;
}

const isFiniteLook = (target: BlubModelLookTarget | null | undefined): target is BlubModelLookTarget =>
  target != null && Number.isFinite(target.yaw) && Number.isFinite(target.pitch);

export function createBlubModel(opts: BlubModelOptions = {}): BlubModel {
  const shapeName = opts.shape ?? 'circle';
  const faceName = opts.face ?? 'neutral';
  const action = requireAction(opts.action ?? 'idle');
  const finishOption: BlubModelFinish = opts.finish === 'flat' ? 'flat' : 'clay';

  let body = colorHex(opts.color ?? 'blue');
  const paperIsAuto = opts.paper == null;
  const eyeIsAuto = opts.eye == null || opts.eye === 'auto';
  let paper = paperIsAuto ? autoEye(body) : colorHex(opts.paper);
  let eye = eyeIsAuto ? autoEye(body) : colorHex(opts.eye);

  let shape = requireShape(shapeName);
  let face = requireFace(faceName);
  let finish = finishOption;
  let ambient = opts.ambient !== false;
  let wear: readonly AccessoryWear[] = [];

  const engine = new BlubEngine(
    100,
    action,
    SHAPE_BY_ID.get(shape)?.radii ?? null,
    EXPRESSION_BY_ID.get(face) ?? null,
  );
  engine.setLook({ ...IDLE_LOOK }, 0);

  function setShape(name: string, t = 0): void {
    const id = requireShape(name);
    if (id === shape) return;
    shape = id;
    engine.setShape(SHAPE_BY_ID.get(id)?.radii ?? null, t);
  }

  function setFace(name: string, t = 0): void {
    const id = requireFace(name);
    if (id === face) return;
    face = id;
    engine.setExpression((EXPRESSION_BY_ID.get(id) ?? null) as Expression | null, t);
  }

  function setColor(value: string): void {
    body = colorHex(value);
    if (paperIsAuto) paper = autoEye(body);
    if (eyeIsAuto) eye = autoEye(body);
  }

  function setFinish(value: string): void {
    finish = value === 'flat' ? 'flat' : 'clay';
  }

  function setAmbient(enabled: boolean): void {
    ambient = enabled;
  }

  function play(name: string, t = 0, { restart = false }: { restart?: boolean } = {}): void {
    const id = requireAction(name);
    if (restart || engine.state === id) engine.reset(id, t);
    else engine.setState(id, t);
  }

  function look(target: BlubModelLookTarget | null, t = 0, morph?: number): void {
    if (target == null) {
      engine.setLook({ ...IDLE_LOOK }, t, morph);
    } else if (isFiniteLook(target)) {
      engine.setLook({ yaw: target.yaw, pitch: target.pitch, mix: 1, spin: 0, wander: 0 }, t, morph);
    }
  }

  return {
    setShape,
    setFace,
    setColor,
    setFinish,
    setAmbient,
    setAccessories(next: readonly AccessoryWear[], t = 0, instant = false): void {
      wear = [...next];
      // Without ambient motion (reduced motion) things are simply on or off.
      engine.setAccessories(wear, t, instant || !ambient);
    },
    get accessories(): readonly AccessoryWear[] {
      return wear;
    },
    play,
    look,
    sample(t: number): BlubSample {
      return engine.sample(t, ambient);
    },
    get state(): StateId {
      return engine.state;
    },
    get shape(): string {
      return shape;
    },
    get face(): string {
      return face;
    },
    get color(): string {
      return body;
    },
    get finish(): BlubModelFinish {
      return finish;
    },
    get paper(): string {
      return paper;
    },
    get eye(): string {
      return eye;
    },
  };
}
