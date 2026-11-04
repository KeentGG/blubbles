// Moments: beats, validation, the builder, and the global/per-blub preset
// registry. Scheduling lives in src/internal/moment-runner.ts.
import { normalizeAccessories } from './accessories.js';
import type { AccessoryInput } from './accessories.js';
import {
  requestColor,
} from './moment-helpers.js';
import {
  requireAction,
  requireStatus,
} from './commands.js';
import type {
  Action,
  Color,
  Face,
  Finish,
  FollowSpec,
  Shape,
  Status,
} from './commands.js';
import { validateClayPatch } from './clay.js';
import type { ClayOptions } from './clay.js';
import { requireFace, requireShape, suggestion, list, quote } from '../resolve.js';
import type { PlayStatus } from './commands.js';

export type MomentLook = { x: number; y: number } | { yaw: number; pitch: number } | Element | string | null;

export interface MomentBeat {
  accessories?: readonly AccessoryInput[];
  face?: Face;
  shape?: Shape;
  color?: Color;
  finish?: Finish;
  clay?: number | ClayOptions;
  eye?: 'auto' | Color;
  paper?: 'auto' | Color;
  status?: Status;
  play?: Action;
  look?: MomentLook;
  follow?: FollowSpec;
  /** Fixed duration in seconds; extends a play action if longer. */
  hold?: number;
  /** Empty beat held for this many seconds. */
  wait?: number;
  cue?: MomentCue | MomentCue[];
}

export interface MomentCue extends Omit<MomentBeat, 'play' | 'cue'> {
  /** Seconds after the beat starts. */
  at: number;
}

export type MomentParams = Record<string, unknown>;
export type MomentDefinition =
  | MomentBeat[]
  | ((params: MomentParams) => MomentBeat[]);

export interface MomentDefinitionOptions {
  /** Default for runs of this definition. true for named moments. */
  restore?: boolean | 'all';
}

export interface MomentRunOptions {
  /** true (named presets) or 'all' also restores shape/colour; false for ad-hoc chains. */
  restore?: boolean | 'all';
  /** Wait for the current run instead of interrupting it. */
  queue?: boolean;
  signal?: AbortSignal;
}

export interface MomentResult {
  status: PlayStatus;
}

export interface MomentBuilder {
  do(beat: MomentBeat): this;
  wait(seconds: number): this;
  hold(seconds: number): this;
  face(value: Face): this;
  shape(value: Shape): this;
  color(value: Color): this;
  finish(value: Finish): this;
  accessories(value: readonly AccessoryInput[]): this;
  clay(value: number | ClayOptions): this;
  eye(value: 'auto' | Color): this;
  paper(value: 'auto' | Color): this;
  status(value: Status): this;
  play(value: Action): this;
  look(value: MomentLook): this;
  follow(value: FollowSpec): this;
  set(value: Omit<MomentBeat, 'cue' | 'play' | 'status' | 'look' | 'follow' | 'hold' | 'wait'>): this;
  run(options?: MomentRunOptions): Promise<MomentResult>;
}

const BEAT_KEYS = [
  'accessories',
  'face',
  'shape',
  'color',
  'finish',
  'clay',
  'eye',
  'paper',
  'status',
  'play',
  'look',
  'follow',
  'hold',
  'wait',
  'cue',
] as const;

const CUE_KEYS = BEAT_KEYS.filter(
  (key) => key !== 'play' && key !== 'cue' && key !== 'hold' && key !== 'wait',
);

const finiteTime = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite, non-negative number of seconds.`);
  }
  return value;
};

function validateLook(value: unknown): MomentLook {
  if (value === null || typeof value === 'string') return value;
  if (typeof Element !== 'undefined' && value instanceof Element) return value;
  if (value !== null && typeof value === 'object') {
    if ('x' in value && 'y' in value) {
      const point = value as { x: unknown; y: unknown };
      if (typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)) {
        return { x: point.x, y: point.y };
      }
    }
    if ('yaw' in value && 'pitch' in value) {
      const gaze = value as { yaw: unknown; pitch: unknown };
      if (typeof gaze.yaw === 'number' && Number.isFinite(gaze.yaw) && typeof gaze.pitch === 'number' && Number.isFinite(gaze.pitch)) {
        return { yaw: gaze.yaw, pitch: gaze.pitch };
      }
    }
  }
  throw new TypeError('beat.look must be a selector, Element, { x, y }, { yaw, pitch } or null.');
}

function validateFollow(value: unknown): FollowSpec {
  if (value === null || typeof value === 'string' || typeof value === 'function') {
    return value as FollowSpec;
  }
  if (typeof Element !== 'undefined' && value instanceof Element) return value;
  if (Array.isArray(value)) return value as FollowSpec;
  if (value !== null && typeof value === 'object') {
    const object = value as { target?: unknown; el?: unknown };
    if (object.el !== undefined || object.target !== undefined) return value as FollowSpec;
  }
  throw new TypeError('beat.follow must be a target, an array of targets, or null.');
}

function validateCue(value: unknown): MomentCue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('beat.cue must be an object or an array of cue objects.');
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key === 'play' || key === 'cue' || key === 'hold' || key === 'wait') {
      throw new TypeError(`A cue cannot contain ${quote(key)}.`);
    }
    if (key !== 'at' && !(CUE_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`Unknown cue key ${quote(key)}. Valid keys: ${list(['at', ...CUE_KEYS])}.`);
    }
  }
  if (!(raw.at !== undefined)) throw new TypeError('A cue needs an "at" offset.');
  const at = finiteTime(raw.at, 'cue.at');
  const rest = { ...raw };
  delete rest.at;
  const beat = validateBeat(rest, 'cue');
  return { ...beat, at };
}

/** Validate one beat strictly. Throws with the bad key and the valid keys. */
export function validateBeat(raw: unknown, context = 'beat'): MomentBeat {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`A ${context} must be an object.`);
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(BEAT_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(
        `Unknown ${context} key ${quote(key)}. Valid keys: ${list(BEAT_KEYS)}.`,
      );
    }
  }
  const out: MomentBeat = {};
  if (source.accessories !== undefined) {
    normalizeAccessories(source.accessories);
    out.accessories = source.accessories as readonly AccessoryInput[];
  }
  if (source.face !== undefined) out.face = requireFace(source.face);
  if (source.shape !== undefined) out.shape = requireShape(source.shape);
  if (source.color !== undefined) out.color = requestColor(source.color);
  if (source.finish !== undefined) {
    if (source.finish !== 'clay' && source.finish !== 'flat') {
      throw new TypeError(`Unknown finish ${quote(source.finish)}. Valid finishes: "clay", "flat".`);
    }
    out.finish = source.finish;
  }
  if (source.clay !== undefined) out.clay = validateClayPatch(source.clay);
  if (source.eye !== undefined) {
    out.eye = source.eye === 'auto' ? 'auto' : requestColor(source.eye);
  }
  if (source.paper !== undefined) {
    out.paper = source.paper === 'auto' ? 'auto' : requestColor(source.paper);
  }
  if (source.status !== undefined) out.status = requireStatus(source.status);
  if (source.play !== undefined) out.play = requireAction(source.play);
  if (source.look !== undefined) out.look = validateLook(source.look);
  if (source.follow !== undefined) out.follow = validateFollow(source.follow);
  if (source.hold !== undefined) out.hold = finiteTime(source.hold, 'beat.hold');
  if (source.wait !== undefined) out.wait = finiteTime(source.wait, 'beat.wait');
  if (source.cue !== undefined) {
    out.cue = Array.isArray(source.cue)
      ? source.cue.map(validateCue)
      : validateCue(source.cue);
  }
  return out;
}

export function validateBeats(raw: unknown): MomentBeat[] {
  if (!Array.isArray(raw)) throw new TypeError('A moment must be an array of beats.');
  return raw.map((beat) => validateBeat(beat));
}

export function validateDefinition(def: unknown): MomentDefinition {
  if (typeof def === 'function') {
    return (params: MomentParams): MomentBeat[] => validateBeats(def(params));
  }
  return validateBeats(def);
}

export interface RegistryEntry {
  def: MomentDefinition;
  defaultRestore: boolean | 'all';
}

const GLOBAL = new Map<string, RegistryEntry>();
const BUILTIN_NAMES = new Set<string>();

function checkName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('A moment name must be a non-empty string.');
  }
  return name;
}

/** Define a moment globally. It overrides a built-in with the same name. */
export function defineMoment(
  name: string,
  def: MomentDefinition,
  options: MomentDefinitionOptions = {},
): void {
  const key = checkName(name);
  GLOBAL.set(key, {
    def: validateDefinition(def),
    defaultRestore: options.restore ?? true,
  });
}

function builtin(
  name: string,
  def: MomentDefinition,
  options: MomentDefinitionOptions,
): void {
  GLOBAL.set(name, { def: validateDefinition(def), defaultRestore: options.restore ?? true });
  BUILTIN_NAMES.add(name);
}

export function momentNames(): string[] {
  return [...GLOBAL.keys()];
}

export type MomentRegistry = Map<string, RegistryEntry>;

export function lookupMoment(
  name: string,
  local?: MomentRegistry,
): RegistryEntry | null {
  return local?.get(name) ?? GLOBAL.get(name) ?? null;
}

export function unknownMoment(name: unknown, local?: MomentRegistry): TypeError {
  const names = [...new Set([...momentNames(), ...(local ? local.keys() : [])])];
  return new TypeError(
    `Unknown moment ${quote(name)}.${suggestion(name, names)} Valid moments: ${list(names)}.`,
  );
}

export function registerLocal(
  local: MomentRegistry,
  name: string,
  def: MomentDefinition,
  options: MomentDefinitionOptions = {},
): void {
  local.set(checkName(name), {
    def: validateDefinition(def),
    defaultRestore: options.restore ?? true,
  });
}

builtin('newNotification', (params) => {
  const target = params.target as MomentLook | undefined;
  const first: MomentBeat = { face: 'surprised', play: 'notify' };
  if (target !== undefined) first.look = target;
  return [first, { face: 'happy', hold: 0.6 }];
}, {});

builtin('success', [
  { face: 'excited', play: 'celebrate' },
  { face: 'happy', hold: 0.6 },
], {});

builtin('error', [
  { face: 'sad', play: 'exclaim' },
  { face: 'neutral' },
], {});

builtin('greeting', [
  { face: 'happy', play: 'wink' },
  { follow: 'pointer' },
], { restore: false });

builtin('thinkingDone', [
  { status: 'thinking' },
  { face: 'curious', hold: 0.4 },
  { face: 'happy', hold: 0.6 },
], {});

/** Create the chain builder. Each chained call is its own beat. */
export function createMomentBuilder(
  start: (beats: MomentBeat[], options: MomentRunOptions) => Promise<MomentResult>,
): MomentBuilder {
  const beats: MomentBeat[] = [];
  const push = (beat: MomentBeat): MomentBuilder => {
    beats.push(validateBeat(beat));
    return builder;
  };
  const builder: MomentBuilder = {
    do(beat) { return push(beat); },
    wait(seconds) { return push({ wait: seconds }); },
    hold(seconds) { return push({ hold: seconds }); },
    face(value) { return push({ face: value }); },
    shape(value) { return push({ shape: value }); },
    color(value) { return push({ color: value }); },
    finish(value) { return push({ finish: value }); },
    accessories(value) { return push({ accessories: value }); },
    clay(value) { return push({ clay: value }); },
    eye(value) { return push({ eye: value }); },
    paper(value) { return push({ paper: value }); },
    status(value) { return push({ status: value }); },
    play(value) { return push({ play: value }); },
    look(value) { return push({ look: value }); },
    follow(value) { return push({ follow: value }); },
    set(value) { return push({ ...value }); },
    run(options = {}) {
      return start([...beats], options);
    },
  };
  return builder;
}

export type MomentCommand =
  | {
      type: 'run';
      moment: string;
      params?: MomentParams;
      restore?: boolean | 'all';
      queue?: boolean;
    }
  | { type: 'stop' }
  | { type: 'define'; name: string; beats: MomentBeat[]; restore?: boolean | 'all' };

/** Validate a run/stop/define command (JSON path). Throws with the bad value. */
export function validateMomentCommand(raw: unknown): MomentCommand {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('A command must be an object with a "type" field.');
  }
  const command = raw as Record<string, unknown>;
  if (command.type === 'stop') {
    for (const key of Object.keys(command)) {
      if (key !== 'type') throw new TypeError(`Unknown field ${quote(key)} on a stop command.`);
    }
    return { type: 'stop' };
  }
  if (command.type === 'run') {
    if (typeof command.moment !== 'string' || !command.moment.trim()) {
      throw new TypeError('run.moment must be a non-empty string.');
    }
    if (command.params !== undefined && (command.params === null || typeof command.params !== 'object' || Array.isArray(command.params))) {
      throw new TypeError('run.params must be an object.');
    }
    if (command.restore !== undefined && command.restore !== true && command.restore !== false && command.restore !== 'all') {
      throw new TypeError('run.restore must be true, false or "all".');
    }
    if (command.queue !== undefined && typeof command.queue !== 'boolean') {
      throw new TypeError('run.queue must be a boolean.');
    }
    for (const key of Object.keys(command)) {
      if (!['type', 'moment', 'params', 'restore', 'queue'].includes(key)) {
        throw new TypeError(`Unknown field ${quote(key)} on a run command.`);
      }
    }
    const out: MomentCommand = { type: 'run', moment: command.moment };
    if (command.params !== undefined) out.params = command.params as MomentParams;
    if (command.restore !== undefined) out.restore = command.restore as boolean | 'all';
    if (command.queue !== undefined) out.queue = command.queue;
    return out;
  }
  if (command.type === 'define') {
    if (typeof command.name !== 'string' || !command.name.trim()) {
      throw new TypeError('define.name must be a non-empty string.');
    }
    if (command.restore !== undefined && command.restore !== true && command.restore !== false && command.restore !== 'all') {
      throw new TypeError('define.restore must be true, false or "all".');
    }
    for (const key of Object.keys(command)) {
      if (!['type', 'name', 'beats', 'restore'].includes(key)) {
        throw new TypeError(`Unknown field ${quote(key)} on a define command.`);
      }
    }
    const out: MomentCommand = { type: 'define', name: command.name, beats: validateBeats(command.beats) };
    if (command.restore !== undefined) out.restore = command.restore as boolean | 'all';
    return out;
  }
  throw new TypeError(
    `Unknown command type ${quote(command.type)}.${suggestion(command.type, ['run', 'stop', 'define'])} Valid types: "run", "stop", "define".`,
  );
}
