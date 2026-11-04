// The developer-facing vocabulary: shapes, faces, colours, statuses and actions,
// plus the serialisable command union and its JSON Schema.
import { ACCESSORY_NAMES, normalizeAccessories } from './accessories.js';
import type { Accessory, AccessoryInput } from './accessories.js';
import {
  SHAPES as NAMED_SHAPES,
  FACES as NAMED_FACES,
  COLORS as NAMED_COLORS,
} from '../names.js';
import {
  quote,
  list,
  suggestion,
  unknown,
  requireShape,
  requireFace,
  requireColor,
} from '../resolve.js';
import type { BlubFace, BlubShape } from '../names.js';
import type { StateId } from '../types.js';
import { normalizeFollow } from '../internal/follow-gate.js';
import { validateClayPatch } from './clay.js';
import type { ClayOptions } from './clay.js';
import type { MomentCommand } from './moments.js';

export type Shape = BlubShape;
export type Face = BlubFace;
export type Finish = 'clay' | 'flat';
export type Action =
  | 'wink'
  | 'notify'
  | 'exclaim'
  | 'hatch'
  | 'crystallize'
  | 'celebrate'
  | 'orbit'
  | 'swirl'
  | 'burst'
  | 'comet';
export type Status = 'idle' | 'thinking' | 'listening' | 'sleeping' | 'alert';
export type ColorName =
  | 'ink'
  | 'cream'
  | 'brown'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'turquoise'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'grey';
export type Color = ColorName | `#${string}`;

/** Pickers can use these directly; they are engine ids, in engine order. */
export const SHAPES = NAMED_SHAPES as Shape[];
export const FACES = NAMED_FACES as Face[];
/** Name -> hex. */
export const COLORS = NAMED_COLORS;
export const COLOR_NAMES = Object.keys(NAMED_COLORS) as ColorName[];

/**
 * One-shot actions, in engine-state order. Each maps to exactly one engine state:
 * wink=wink, notify=notify, exclaim=exclaim, hatch=egg, crystallize=hexagon,
 * celebrate=play, orbit=orbit, swirl=swirl, burst=burst, comet=comet.
 */
export const ACTION_STATES = {
  wink: 'wink',
  notify: 'notify',
  exclaim: 'exclaim',
  hatch: 'egg',
  crystallize: 'hexagon',
  celebrate: 'play',
  orbit: 'orbit',
  swirl: 'swirl',
  burst: 'burst',
  comet: 'comet',
} as const satisfies Record<Action, StateId>;

/**
 * Looping statuses. Each maps to one engine state: idle=idle, thinking=thinking,
 * listening=wide, sleeping=sleep, alert=alert. A status holds until the next one.
 */
export const STATUS_STATES = {
  idle: 'idle',
  thinking: 'thinking',
  listening: 'wide',
  sleeping: 'sleep',
  alert: 'alert',
} as const satisfies Record<Status, StateId>;

export const ACTIONS = Object.keys(ACTION_STATES) as Action[];
const wearToInput = (wear: { id: Accessory; color: string | null }): AccessoryInput =>
  wear.color === null ? wear.id : { id: wear.id, color: wear.color };

export const STATUSES = Object.keys(STATUS_STATES) as Status[];

export interface BlubSetOptions {
  /** What it wears: replaces the current list. `[]` takes everything off. */
  accessories?: readonly AccessoryInput[];
  shape?: Shape;
  face?: Face;
  color?: Color;
  finish?: Finish;
  /** Clay intensity: number shorthand or partial { highlight, shadow, light }. */
  clay?: number | ClayOptions;
  /** Eye cut-out colour, or 'auto'. */
  eye?: 'auto' | Color;
  /** Paper/body-underfill colour, or 'auto'. */
  paper?: 'auto' | Color;
}

export type FollowLeave = 'previous' | 'wander' | 'center';

export interface FollowPoint {
  x: number;
  y: number;
}

export interface FollowRange {
  /** Maximum absolute yaw in degrees. */
  yaw: number;
  /** Maximum absolute pitch in degrees. */
  pitch: number;
}

export interface FollowElementTarget {
  readonly el: SVGSVGElement;
}

export interface FollowPointerFacts {
  /** Page px, last known. */
  readonly x: number;
  readonly y: number;
  /** Smoothed speed in CSS px/s. */
  readonly speed: number;
  /** CSS px from the blub centre. */
  readonly distance: number;
  /** Within the follow radius (or the blub box). */
  readonly inside: boolean;
  /** In the window and moved within the last ~2 s. */
  readonly active: boolean;
  /** Seconds since the last pointer move. */
  readonly idle: number;
  /** Button or touch pressed. */
  readonly down: boolean;
  readonly type: 'mouse' | 'pen' | 'touch';
}

export interface FollowBlubFacts {
  /** Page px, cached. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly center: { readonly x: number; readonly y: number };
  readonly status: Status;
  readonly action: Action | null;
  readonly face: Face;
  /** On screen and tab visible. */
  readonly visible: boolean;
}

export interface FollowFocusFacts {
  readonly el: Element | null;
  /** Input/textarea/contenteditable has focus. */
  readonly typing: boolean;
  /** Seconds since the last keystroke. */
  readonly idle: number;
}

export interface FollowCurrentFact {
  readonly target: FollowTarget | null;
  readonly weight: number;
  /** Seconds on this target. */
  readonly since: number;
}

export interface FollowMeasurement {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly visible: boolean;
}

/** Reused every frame. Read-only, and only valid during the call. */
export interface FollowContext {
  readonly time: number;
  readonly dt: number;
  readonly blub: FollowBlubFacts;
  readonly pointer: FollowPointerFacts;
  readonly focus: FollowFocusFacts;
  readonly caret: FollowPoint | null;
  readonly current: FollowCurrentFact;
  readonly gaze: { readonly yaw: number; readonly pitch: number };
  /** Cached element measurement; never forces layout. */
  measure(el: Element): FollowMeasurement | null;
}

export interface FollowEntryOptions {
  /** 0..1; 0 ignores the entry, 1 is top priority. Default 1. */
  weight?: number;
  /** CSS px from the blub centre, or 'element' for the blub's own box. */
  radius?: number | 'element';
  /** Leave radius in CSS px. Default radius * 1.25; must be >= radius. */
  exitRadius?: number;
  onLeave?: FollowLeave;
  /** Gaze catch-up multiplier. Default 1. */
  speed?: number;
  /** Clamp the final gaze in degrees. */
  range?: FollowRange;
  /** 'look' at the target (default) or 'avoid' it. */
  mode?: 'look' | 'avoid';
  /** Reaction lag in seconds. Default 0. */
  delay?: number;
}

/** @deprecated Use FollowEntryOptions. */
export type FollowPointerOptions = FollowEntryOptions;

export interface FollowEntry extends FollowEntryOptions {
  target: FollowTarget;
}

export type FollowDynamicResult = FollowPoint | null | FollowEntryInput[];

export type FollowTarget =
  | 'pointer'
  | 'focus'
  | 'caret'
  | Element
  | string
  | FollowElementTarget
  | ((context: FollowContext) => FollowDynamicResult)
  | null;

export type FollowEntryInput = FollowTarget | FollowEntry;

export interface FollowOptions extends FollowEntryOptions {
  /** Pick one winner (default) or weight-average the active gazes. */
  pick?: 'strongest' | 'blend';
  /** A rival must beat the current target by this much weight. Default 0.1. */
  switchMargin?: number;
  /** A rival must hold the lead this long before switching, in seconds. Default 0.25. */
  minHold?: number;
}

export type FollowSpec =
  | FollowTarget
  | FollowEntry
  | FollowEntryInput[]
  | ((context: FollowContext) => FollowDynamicResult);

export type BlubLookTarget =
  | { x: number; y: number }
  | { yaw: number; pitch: number }
  | null;

export interface FollowCommandEntry extends FollowEntryOptions {
  target: string;
}

export type FollowCommandItem = string | FollowCommandEntry;

export type FollowCommandTarget = string | FollowCommandItem[] | null;

export type BlubCommand =
  | { type: 'play'; action: Action; interrupt?: boolean }
  | { type: 'status'; status: Status }
  | {
      type: 'set';
      accessories?: readonly AccessoryInput[];
      shape?: Shape;
      face?: Face;
      color?: Color;
      finish?: Finish;
      clay?: number | ClayOptions;
      eye?: 'auto' | Color;
      paper?: 'auto' | Color;
    }
  | { type: 'look'; yaw: number; pitch: number }
  | ({ type: 'follow'; target: FollowCommandTarget } & FollowOptions)
  | MomentCommand;

export interface BlubState {
  accessories: readonly { id: Accessory; color: string | null }[];
  shape: Shape;
  face: Face;
  color: string;
  finish: Finish;
  status: Status;
  action: Action | null;
}

export type PlayStatus = 'completed' | 'interrupted' | 'cancelled';

export interface PlayResult {
  status: PlayStatus;
}

export interface BlubEvents {
  'action:end': { action: Action; interrupted: boolean };
  'status:change': { status: Status; previous: Status };
  'follow:enter': Record<string, never>;
  'follow:leave': Record<string, never>;
  'follow:target': { from: string | null; to: string | null };
  'moment:start': { name: string };
  'moment:beat': { name: string; index: number };
  'moment:end': { name: string; status: PlayStatus };
  change: Readonly<BlubState>;
}

export function requireFinish(value: unknown): Finish {
  if (value === 'clay' || value === 'flat') return value;
  throw unknown('finish', value, ['clay', 'flat']);
}

export function requireAction(value: unknown): Action {
  if (typeof value === 'string' && (ACTIONS as string[]).includes(value)) {
    return value as Action;
  }
  throw unknown('action', value, ACTIONS);
}

export function requireStatus(value: unknown): Status {
  if (typeof value === 'string' && (STATUSES as string[]).includes(value)) {
    return value as Status;
  }
  throw unknown('status', value, STATUSES);
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${quote(value)}.`);
  }
  return value;
}

const COMMAND_TYPES = ['play', 'status', 'set', 'look', 'follow'] as const;

/** Validate one command and return a normalised copy. Throws TypeError. */
export function validateCommand(raw: unknown): BlubCommand {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('A command must be an object with a "type" field.');
  }
  const command = raw as Record<string, unknown>;
  const type = command.type;
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type)) {
    throw new TypeError(
      `Unknown command type ${quote(type)}.${suggestion(type, COMMAND_TYPES)} Valid types: ${list(COMMAND_TYPES)}.`,
    );
  }
  switch (type) {
    case 'play': {
      const action = requireAction(command.action);
      if (command.interrupt !== undefined && typeof command.interrupt !== 'boolean') {
        throw new TypeError('play.interrupt must be a boolean.');
      }
      return command.interrupt === undefined
        ? { type, action }
        : { type, action, interrupt: command.interrupt };
    }
    case 'status':
      return { type, status: requireStatus(command.status) };
    case 'set': {
      const out: Extract<BlubCommand, { type: 'set' }> = { type };
      if (command.accessories !== undefined) out.accessories = normalizeAccessories(command.accessories).map(wearToInput);
      if (command.shape !== undefined) out.shape = requireShape(command.shape);
      if (command.face !== undefined) out.face = requireFace(command.face);
      if (command.color !== undefined) out.color = requireColor(command.color) as Color;
      if (command.finish !== undefined) out.finish = requireFinish(command.finish);
      if (command.clay !== undefined) out.clay = validateClayPatch(command.clay);
      if (command.eye !== undefined) {
        out.eye = command.eye === 'auto' ? 'auto' : (requireColor(command.eye) as Color);
      }
      if (command.paper !== undefined) {
        out.paper = command.paper === 'auto' ? 'auto' : (requireColor(command.paper) as Color);
      }
      for (const key of Object.keys(command)) {
        if (
          key !== 'type' &&
          key !== 'accessories' &&
          key !== 'shape' &&
          key !== 'face' &&
          key !== 'color' &&
          key !== 'finish' &&
          key !== 'clay' &&
          key !== 'eye' &&
          key !== 'paper'
        ) {
          throw new TypeError(`Unknown field ${quote(key)} on a set command.`);
        }
      }
      return out;
    }
    case 'look':
      return {
        type,
        yaw: requireFinite(command.yaw, 'look.yaw'),
        pitch: requireFinite(command.pitch, 'look.pitch'),
      };
    case 'follow': {
      const target = command.target;
      if (target !== null && typeof target !== 'string' && !Array.isArray(target)) {
        throw new TypeError('follow.target must be a string, an array of entries, or null.');
      }
      if (Array.isArray(target)) {
        for (const entry of target) {
          if (typeof entry === 'string') continue;
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new TypeError('follow.target entries must be strings or objects with a target.');
          }
          if (typeof entry.target !== 'string') {
            throw new TypeError('follow.target entries need a string target.');
          }
          normalizeFollow(entry);
          if (entry.weight !== undefined && (typeof entry.weight !== 'number' || entry.weight < 0 || entry.weight > 1)) {
            throw new TypeError('follow entry weight must be between 0 and 1.');
          }
        }
      }
      const radius = command.radius as number | 'element' | undefined;
      const exitRadius = command.exitRadius as number | undefined;
      const onLeave = command.onLeave as FollowLeave | undefined;
      normalizeFollow({ radius, exitRadius, onLeave });
      const out: Extract<BlubCommand, { type: 'follow' }> = { type, target: target as FollowCommandTarget };
      for (const key of ['weight', 'radius', 'exitRadius', 'onLeave', 'speed', 'range', 'mode', 'delay', 'pick', 'switchMargin', 'minHold'] as const) {
        if (command[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = command[key];
      }
      return out;
    }
    default:
      throw new TypeError(`Unknown command type ${quote(type)}.`);
  }
}

const colorSchema = {
  anyOf: [{ enum: COLOR_NAMES }, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }],
};


const claySchema = {
  anyOf: [
    { type: 'number', minimum: 0, maximum: 2 },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        highlight: { type: 'number', minimum: 0, maximum: 2 },
        shadow: { type: 'number', minimum: 0, maximum: 2 },
        light: {
          type: 'object',
          additionalProperties: false,
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
      },
    },
  ],
};

const beatLookSchema = {
  oneOf: [
    { type: 'string' },
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['yaw', 'pitch'],
      properties: { yaw: { type: 'number' }, pitch: { type: 'number' } },
    },
  ],
};

const beatFollowSchema = {
  oneOf: [
    { type: 'string' },
    { type: 'null' },
    { type: 'array' },
  ],
};

const accessoriesSchema = {
  type: 'array',
  items: {
    anyOf: [
      { enum: ACCESSORY_NAMES },
      {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { enum: ACCESSORY_NAMES }, color: colorSchema },
      },
    ],
  },
};

const cueProperties = {
  accessories: accessoriesSchema,
  face: { enum: FACES },
  shape: { enum: SHAPES },
  color: colorSchema,
  finish: { enum: ['clay', 'flat'] },
  clay: claySchema,
  eye: { anyOf: [{ const: 'auto' }, colorSchema] },
  paper: { anyOf: [{ const: 'auto' }, colorSchema] },
  status: { enum: STATUSES },
  look: beatLookSchema,
  follow: beatFollowSchema,
  hold: { type: 'number', minimum: 0 },
  wait: { type: 'number', minimum: 0 },
  at: { type: 'number', minimum: 0 },
};

const beatProperties = {
  accessories: accessoriesSchema,
  face: { enum: FACES },
  shape: { enum: SHAPES },
  color: colorSchema,
  finish: { enum: ['clay', 'flat'] },
  clay: claySchema,
  eye: { anyOf: [{ const: 'auto' }, colorSchema] },
  paper: { anyOf: [{ const: 'auto' }, colorSchema] },
  status: { enum: STATUSES },
  play: { enum: ACTIONS },
  look: beatLookSchema,
  follow: beatFollowSchema,
  hold: { type: 'number', minimum: 0 },
  wait: { type: 'number', minimum: 0 },
  cue: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['at'],
        properties: cueProperties,
      },
      {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['at'],
          properties: cueProperties,
        },
      },
    ],
  },
};

const beatSchema = {
  type: 'object',
  additionalProperties: false,
  properties: beatProperties,
};

/** JSON Schema for BlubCommand: pass it straight to an LLM as a tool schema. */
export const commandSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BlubCommand',
  description: 'A command for a Blubbles avatar.',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'action'],
      properties: {
        type: { const: 'play' },
        action: { enum: ACTIONS, description: 'One-shot action to play.' },
        interrupt: {
          type: 'boolean',
          description: 'Cut in now instead of queueing behind the current action.',
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'status'],
      properties: {
        type: { const: 'status' },
        status: { enum: STATUSES, description: 'Looping status to hold.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { const: 'set' },
        accessories: accessoriesSchema,
        shape: { enum: SHAPES },
        face: { enum: FACES },
        color: colorSchema,
        finish: { enum: ['clay', 'flat'] },
        clay: {
          anyOf: [
            { type: 'number', minimum: 0, maximum: 2 },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                highlight: { type: 'number', minimum: 0, maximum: 2 },
                shadow: { type: 'number', minimum: 0, maximum: 2 },
                light: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                },
              },
            },
          ],
        },
        eye: { anyOf: [{ const: 'auto' }, colorSchema] },
        paper: { anyOf: [{ const: 'auto' }, colorSchema] },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'yaw', 'pitch'],
      properties: {
        type: { const: 'look' },
        yaw: { type: 'number', description: 'Horizontal gaze, roughly -20..20.' },
        pitch: { type: 'number', description: 'Vertical gaze, roughly -15..15.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'target'],
      properties: {
        type: { const: 'follow' },
        target: {
          oneOf: [
            { type: 'string' },
            { type: 'null' },
            {
              type: 'array',
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['target'],
                    properties: {
                      target: { type: 'string' },
                  weight: { type: 'number', minimum: 0, maximum: 1 },
                  radius: {
                    anyOf: [
                      { type: 'number', exclusiveMinimum: 0 },
                      { const: 'element' },
                    ],
                  },
                  exitRadius: { type: 'number', exclusiveMinimum: 0 },
                  onLeave: { enum: ['previous', 'wander', 'center'] },
                  speed: { type: 'number', exclusiveMinimum: 0 },
                  range: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      yaw: { type: 'number', minimum: 0 },
                      pitch: { type: 'number', minimum: 0 },
                    },
                  },
                      mode: { enum: ['look', 'avoid'] },
                      delay: { type: 'number', minimum: 0 },
                    },
                  },
                ],
              },
            },
          ],
        },
        weight: { type: 'number', minimum: 0, maximum: 1 },
        radius: {
          anyOf: [
            { type: 'number', exclusiveMinimum: 0 },
            { const: 'element' },
          ],
        },
        exitRadius: { type: 'number', exclusiveMinimum: 0 },
        onLeave: { enum: ['previous', 'wander', 'center'] },
        speed: { type: 'number', exclusiveMinimum: 0 },
        range: {
          type: 'object',
          additionalProperties: false,
          properties: {
            yaw: { type: 'number', minimum: 0 },
            pitch: { type: 'number', minimum: 0 },
          },
        },
        mode: { enum: ['look', 'avoid'] },
        delay: { type: 'number', minimum: 0 },
        pick: { enum: ['strongest', 'blend'] },
        switchMargin: { type: 'number', minimum: 0 },
        minHold: { type: 'number', minimum: 0 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'moment'],
      properties: {
        type: { const: 'run' },
        moment: { type: 'string' },
        params: { type: 'object' },
        restore: { anyOf: [{ type: 'boolean' }, { const: 'all' }] },
        queue: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: { const: 'stop' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'name', 'beats'],
      properties: {
        type: { const: 'define' },
        name: { type: 'string' },
        beats: { type: 'array', items: beatSchema },
        restore: { anyOf: [{ type: 'boolean' }, { const: 'all' }] },
      },
    },
  ],
} as const;
