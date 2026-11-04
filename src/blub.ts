// createBlub: the headline SDK. It mounts a blub, owns the clock (rAF or manual),
// and exposes statuses, queued actions, commands, pointer following and events.
import { normalizeAccessories } from './sdk/accessories.js';
import type { AccessoryInput } from './sdk/accessories.js';
import { createBlubCore } from './sdk/core.js';
import { createBlubModel } from './internal/model.js';
import { createBlubView } from './internal/view.js';
import { subscribeFrame } from './internal/scheduler.js';
import { createFollowController } from './internal/follow-controller.js';
import type { FollowController } from './internal/follow-controller.js';
import { createMomentRunner } from './internal/moment-runner.js';
import type { MomentApply, MomentRunner } from './internal/moment-runner.js';
import {
  createMomentBuilder,
  lookupMoment,
  registerLocal,
  unknownMoment,
  validateMomentCommand,
} from './sdk/moments.js';
import type {
  MomentBuilder,
  MomentCue,
  MomentDefinition,
  MomentDefinitionOptions,
  MomentLook,
  MomentBeat,
  MomentParams,
  MomentRegistry,
  MomentResult,
  MomentRunOptions,
} from './sdk/moments.js';
import { createStyleTransition } from './internal/style-transition.js';
import type { StyleTransition, ViewStyle } from './internal/style-transition.js';
import { autoEye } from './palette.js';
import { colorHex, requireColor, requireFace, requireShape } from './resolve.js';
import { clayEqual, mergeClay, normalizeClay } from './sdk/clay.js';
import type { ClayOptions, ClaySettings } from './sdk/clay.js';
import {
  STATUS_STATES,
  requireFinish,
  requireStatus,
  validateCommand,
} from './sdk/commands.js';
import type {
  Action,
  BlubCommand,
  BlubEvents,
  BlubLookTarget,
  BlubSetOptions,
  BlubState,
  Color,
  Face,
  Finish,
  FollowOptions,
  FollowSpec,
  PlayResult,
  Shape,
  Status,
} from './sdk/commands.js';

export interface BlubOptions {
  /** Body shape. Default `'circle'`. */
  shape?: Shape;
  /** Face expression. Default `'happy'`. */
  face?: Face;
  /** Named colour or `#rrggbb`. Default `'blue'`. */
  color?: Color;
  /** `'clay'` (soft gradient) or `'flat'`. Default `'clay'`. */
  finish?: Finish;
  /** What it wears, such as `['hat', 'tie']`: one on the head, one at the neck. */
  accessories?: readonly AccessoryInput[];
  /** Clay intensity: number shorthand or { highlight, shadow, light }. */
  clay?: number | ClayOptions;
  /** Eye cut-out colour, or `'auto'` (default) to contrast with the body. */
  eye?: 'auto' | Color;
  /** Paper/body-underfill colour, or `'auto'` (default) to contrast with the body. */
  paper?: 'auto' | Color;
  /** Default transition for colour/clay/eye/paper changes, in seconds. Default 0.4. */
  transition?: { duration?: number };
  /** Square size in CSS pixels. Default `128`. */
  size?: number;
  /** Initial looping status. Default `'idle'`. */
  status?: Status;
  /**
   * `'auto'` (default) shares one requestAnimationFrame loop with every other blub.
   * `'manual'` disables the loop; drive it with `render(seconds)` or `tick(delta)`.
   */
  clock?: 'auto' | 'manual';
  /** Target render rate for the auto clock. Default `60`; use `30` for many blubs. */
  fps?: number;
  /** Accessible name for the image. Default `'Blubbles avatar'`. */
  ariaLabel?: string;
  /** Destroy the blub when this signal aborts. Handy for React effects. */
  signal?: AbortSignal;
}

export interface Blub {
  /** The mounted `<svg>`. */
  readonly el: SVGSVGElement;
  /** Frozen snapshot of shape, face, colour, finish, status and current action. */
  readonly state: Readonly<BlubState>;
  /** Last rendered time in seconds. */
  readonly time: number;
  /**
   * Change any subset of shape, face, colour, finish, clay, eye or paper.
   * `{ duration }` overrides the instance transition for this call; 0 is instant.
   */
  set(options: BlubSetOptions, options2?: { duration?: number }): void;
  /**
   * Play a one-shot action. Resolves when it ends, is interrupted, or is cancelled.
   * While another action runs, the new one queues; `interrupt: true` cuts in.
   */
  play(action: Action, options?: { interrupt?: boolean }): Promise<PlayResult>;
  /** Hold a looping status until the next `status()` or a `play()`. */
  status(status: Status): void;
  /**
   * Look at a page point ({ x, y }, in CSS px) or a direct gaze ({ yaw, pitch },
   * in degrees). `null` returns to the ambient wander.
   */
  lookAt(target: BlubLookTarget): void;
  /**
   * Follow the pointer. Without options the eyes follow anywhere on the page.
   * `radius`/`exitRadius` add hysteresis; `onLeave` picks the resting gaze.
   */
  follow(spec: FollowSpec, options?: FollowOptions): void;
  /** Apply one serialisable command, or an array in order. */
  send(command: BlubCommand | BlubCommand[]): void;
  /** Start a chain; chained calls are separate beats. Ad-hoc runs do not restore by default. */
  moment(): MomentBuilder;
  /** Define or override a named moment for this blub. */
  define(
    name: string,
    definition: MomentDefinition,
    options?: MomentDefinitionOptions,
  ): void;
  /** Run a named moment (or a built-in preset) and settle when it ends. */
  run(
    name: string,
    params?: MomentParams,
    options?: MomentRunOptions,
  ): Promise<MomentResult>;
  /** Cancel the current moment and any queued runs. */
  stop(): void;
  /**
   * Subscribe to `'action:end'`, `'status:change'`, `'follow:enter'`,
   * `'follow:leave'`, `'follow:target'`, `'moment:start'`, `'moment:beat'`,
   * `'moment:end'` or `'change'`. Returns an unsubscribe; `{ signal }` aborts it.
   */
  on<K extends keyof BlubEvents>(
    event: K,
    listener: (event: BlubEvents[K]) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
  /** Freeze the clock. The SVG stays visible at its last frame. */
  pause(): void;
  /** Resume after `pause()`. */
  resume(): void;
  /** Advance a manual clock by `deltaSeconds`. */
  tick(deltaSeconds: number): void;
  /** Jump a manual clock to an absolute time in seconds. */
  render(seconds: number): void;
  /** Stop the clock, remove listeners/observers and the SVG. Idempotent. */
  destroy(): void;
}

const clockNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const DEV = (() => {
  try {
    const nodeProcess = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    return nodeProcess === undefined || nodeProcess.env?.NODE_ENV !== 'production';
  } catch {
    return true;
  }
})();

function resolveTarget(target: Element | string): Element {
  if (typeof document === 'undefined') {
    throw new Error(
      'createBlub needs a browser DOM. In Node or SSR use renderBlubSVG from "blubbles/engine".',
    );
  }
  if (typeof target === 'string') {
    const found = document.querySelector(target);
    if (!found) {
      throw new TypeError(`createBlub found no element for selector ${JSON.stringify(target)}.`);
    }
    return found;
  }
  if (!target || typeof target.appendChild !== 'function') {
    throw new TypeError('createBlub needs an Element or a CSS selector string.');
  }
  return target;
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function durationOption(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!finite(value) || value < 0) {
    throw new TypeError(`transition.duration must be a finite, non-negative number, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Mount a blub into an element (or a selector) and return its live controller.
 * The auto clock shares one requestAnimationFrame loop with every other blub.
 * In Node or SSR use `renderBlubSVG` from `blubbles/engine`.
 */
export function createBlub(target: Element | string, options: BlubOptions = {}): Blub {
  if (typeof document === 'undefined') {
    throw new Error(
      'createBlub needs a browser DOM. In Node or SSR use renderBlubSVG from "blubbles/engine".',
    );
  }
  if (options.signal?.aborted) throw abortError();
  const element = resolveTarget(target);

  const shape = requireShape(options.shape ?? 'circle');
  const face = requireFace(options.face ?? 'happy');
  const initialColor = colorHex(requireColor(options.color ?? 'blue'));
  const initialFinish = requireFinish(options.finish ?? 'clay');
  const initialStatus = requireStatus(options.status ?? 'idle');
  const initialClay = normalizeClay(options.clay);
  const size = options.size ?? 128;
  if (!finite(size) || size <= 0) {
    throw new TypeError(`size must be a positive number, got ${JSON.stringify(options.size)}.`);
  }
  const clock = options.clock ?? 'auto';
  if (clock !== 'auto' && clock !== 'manual') {
    throw new TypeError(`clock must be "auto" or "manual", got ${JSON.stringify(clock)}.`);
  }
  const fps = options.fps ?? 60;
  if (!finite(fps) || fps <= 0 || fps > 240) {
    throw new TypeError(`fps must be between 1 and 240, got ${JSON.stringify(options.fps)}.`);
  }
  const ariaLabel = options.ariaLabel ?? 'Blubbles avatar';
  if (typeof ariaLabel !== 'string') {
    throw new TypeError('ariaLabel must be a string.');
  }
  const transitionDuration = durationOption(options.transition?.duration, 0.4);

  const motionQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = (): boolean => motionQuery?.matches === true;

  let targetColor = initialColor;
  let targetFinish = initialFinish;
  let targetClay: ClaySettings = initialClay;
  let eyeSpec: 'auto' | Color = options.eye ?? 'auto';
  let paperSpec: 'auto' | Color = options.paper ?? 'auto';

  const resolveAux = (spec: 'auto' | Color, color: string): string =>
    spec === 'auto' ? autoEye(color) : colorHex(requireColor(spec));

  const targetStyle = (): ViewStyle => ({
    color: targetColor,
    paper: resolveAux(paperSpec, targetColor),
    eye: resolveAux(eyeSpec, targetColor),
    finish: targetFinish,
    clay: targetClay,
  });

  const initialStyle = targetStyle();

  const model = createBlubModel({
    shape,
    face,
    color: targetColor,
    finish: targetFinish,
    paper: initialStyle.paper,
    eye: initialStyle.eye,
    action: STATUS_STATES[initialStatus],
    ambient: !reducedMotion(),
  });
  if (options.accessories !== undefined) {
    model.setAccessories(normalizeAccessories(options.accessories), 0, true);
  }
  const view = createBlubView(element, model, { crop: 124, scale: 158, background: null });
  const core = createBlubCore(model, { status: initialStatus });
  const styleTransition: StyleTransition = createStyleTransition(initialStyle);
  view.setStyle(initialStyle);

  const svg = view.el;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
  svg.removeAttribute('aria-hidden');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;

  const manual = clock === 'manual';
  const minFrameMs = 1000 / fps;
  const disposers: (() => void)[] = [];

  let time = 0;
  let epochMs = clockNow();
  let lastRenderMs = epochMs - minFrameMs;
  let userPaused = false;
  let hidden = document.hidden === true;
  let visible = true;
  let destroyed = false;
  let stopFrame: (() => void) | null = null;

  let lastLook: { yaw: number; pitch: number } | null = null;
  let previousLook: { yaw: number; pitch: number } | null = null;
  let controller: FollowController | null = null;
  let followSpec: FollowSpec | null = null;
  let followOptionsState: FollowOptions = {};
  const localMoments: MomentRegistry = new Map();

  interface MomentSnapshot {
    face: Face;
    status: Status;
    shape: Shape;
    color: string;
    finish: Finish;
    accessories: BlubState['accessories'];
    clay: ClaySettings;
    eye: 'auto' | Color;
    paper: 'auto' | Color;
    look: { yaw: number; pitch: number } | null;
    followSpec: FollowSpec | null;
    followOptions: FollowOptions;
  }

  const assertAlive = (): void => {
    if (destroyed) throw new Error('This blub has been destroyed.');
  };

  const applyStyle = (): void => {
    view.setStyle(styleTransition.at(time));
  };

  const renderFrame = (): void => {
    core.tick(time);
    momentRunner.update(time);
    controller?.update(time);
    applyStyle();
    view.render(time);
    lastRenderMs = clockNow();
  };

  const onFrame = (nowMs: number): void => {
    if (destroyed || manual || userPaused || hidden) return;
    time = Math.max(0, (nowMs - epochMs) / 1000);
    core.tick(time);
    momentRunner.update(time);
    controller?.update(time);
    if (!visible) return;
    if (nowMs - lastRenderMs < minFrameMs) return;
    applyStyle();
    view.render(time);
    lastRenderMs = nowMs;
  };

  const startLoop = (): void => {
    if (manual || destroyed || userPaused || hidden || stopFrame) return;
    stopFrame = subscribeFrame(onFrame);
  };

  const stopLoop = (): void => {
    if (!stopFrame) return;
    stopFrame();
    stopFrame = null;
  };

  function applyLook(target: BlubLookTarget, fromTarget: boolean): void {
    if (target === null) {
      core.resetLook();
      if (!fromTarget) lastLook = null;
      return;
    }
    if ('yaw' in target || 'pitch' in target) {
      const { yaw, pitch } = target as { yaw?: unknown; pitch?: unknown };
      if (!finite(yaw) || !finite(pitch)) {
        throw new TypeError('lookAt expects finite yaw and pitch, or finite x and y.');
      }
      core.look(yaw, pitch);
      if (!fromTarget) lastLook = { yaw, pitch };
      return;
    }
    if ('x' in target || 'y' in target) {
      const { x, y } = target as { x?: unknown; y?: unknown };
      if (!finite(x) || !finite(y)) {
        throw new TypeError('lookAt expects finite x and y, or finite yaw and pitch.');
      }
      const rect = svg.getBoundingClientRect();
      const halfWidth = rect.width / 2 || 1;
      const halfHeight = rect.height / 2 || 1;
      const nx = Math.max(-1, Math.min(1, (x - (rect.left + halfWidth)) / halfWidth));
      const ny = Math.max(-1, Math.min(1, (y - (rect.top + halfHeight)) / halfHeight));
      const yaw = 16 * nx;
      const pitch = -13 * ny;
      core.look(yaw, pitch);
      if (!fromTarget) lastLook = { yaw, pitch };
      return;
    }
    throw new TypeError('lookAt expects { x, y }, { yaw, pitch } or null.');
  }

  function lookAt(target: BlubLookTarget): void {
    assertAlive();
    applyLook(target, false);
    applyStyle();
    view.render(time);
  }

  function follow(spec: FollowSpec, followOptions: FollowOptions = {}): void {
    assertAlive();
    if (
      spec !== null &&
      typeof spec !== 'string' &&
      typeof spec !== 'function' &&
      !Array.isArray(spec) &&
      !(spec instanceof Element) &&
      !(typeof spec === 'object' && ('el' in spec || 'target' in spec))
    ) {
      throw new TypeError('follow expects a target, an array of targets, or null.');
    }
    if (spec === null) {
      followSpec = null;
      followOptionsState = {};
      if (controller) {
        controller.stop();
        controller = null;
        applyStyle();
        view.render(time);
      }
      return;
    }
    if (controller) {
      controller.stop();
      controller = null;
      applyStyle();
      view.render(time);
    }
    previousLook = lastLook;
    followSpec = spec;
    followOptionsState = followOptions;
    controller = createFollowController(svg, spec, followOptions, {
      look(yaw, pitch, morph) {
        core.look(yaw, pitch, morph);
      },
      enter() {
        previousLook = lastLook;
        core.followEntered();
      },
      leave(mode) {
        core.followLeft();
        if (mode === 'previous') applyLook(previousLook, false);
        else if (mode === 'wander') applyLook(null, false);
        else applyLook({ yaw: 0, pitch: 0 }, false);
      },
      target(from, to) {
        core.followTarget(from, to);
      },
    }, () => ({
      status: core.state.status,
      action: core.state.action,
      face: core.state.face,
      visible: visible && !hidden,
    }));
  }


  function momentLook(value: MomentLook): BlubLookTarget {
    if (value === null) return null;
    if (typeof value === 'string') {
      if (typeof document === 'undefined') throw new Error('Moment look selectors need a DOM.');
      const found = document.querySelector(value);
      if (!found) throw new TypeError(`Moment look found no element for ${JSON.stringify(value)}.`);
      const rect = found.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (value instanceof Element) {
      const rect = value.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (typeof value === 'object' && value !== null && 'el' in value) {
      return momentLook((value as { el: Element }).el);
    }
    if (typeof value === 'object' && value !== null) return value as BlubLookTarget;
    throw new TypeError('Moment look must be a selector, Element, point, gaze or null.');
  }

  function safeMomentLook(value: MomentLook): BlubLookTarget | undefined {
    try {
      return momentLook(value);
    } catch (error) {
      console.warn('[blubbles] moment look skipped', error);
      return undefined;
    }
  }

  function applyBeat(beat: MomentBeat): MomentApply | null {
    const setOptions: BlubSetOptions = {};
    if (beat.face !== undefined) setOptions.face = beat.face;
    if (beat.shape !== undefined) setOptions.shape = beat.shape;
    if (beat.color !== undefined) setOptions.color = beat.color;
    if (beat.finish !== undefined) setOptions.finish = beat.finish;
    if (beat.accessories !== undefined) setOptions.accessories = beat.accessories;
    if (beat.clay !== undefined) setOptions.clay = beat.clay;
    if (beat.eye !== undefined) setOptions.eye = beat.eye;
    if (beat.paper !== undefined) setOptions.paper = beat.paper;
    if (Object.keys(setOptions).length) set(setOptions);
    if (beat.status !== undefined) status(beat.status);
    if (beat.look !== undefined) {
      const target = safeMomentLook(beat.look);
      if (target !== undefined) {
        // An explicit look wins over an inherited follow for this beat.
        if (beat.follow === undefined && controller) follow(null);
        lookAt(target);
      }
    }
    if (beat.follow !== undefined) follow(beat.follow);
    if (beat.play !== undefined) {
      const action = beat.play;
      return {
        promise: play(action, { interrupt: true }),
        cancel: () => {
          core.cancelAction(action);
        },
      };
    }
    return null;
  }

  function applyCue(cue: MomentCue): void {
    applyBeat(cue);
  }

  function captureMoment(): MomentSnapshot {
    return {
      face: core.state.face,
      status: core.state.status,
      shape: core.state.shape,
      color: targetColor,
      finish: targetFinish,
      accessories: core.state.accessories,
      clay: { ...targetClay, light: { ...targetClay.light } },
      eye: eyeSpec,
      paper: paperSpec,
      look: lastLook ? { ...lastLook } : null,
      followSpec,
      followOptions: followOptionsState,
    };
  }

  function restoreMoment(snapshot: unknown, all: boolean): void {
    const saved = snapshot as MomentSnapshot;
    const setOptions: BlubSetOptions = {};
    if (all) {
      if (saved.shape !== core.state.shape) setOptions.shape = saved.shape;
      if (saved.color !== targetColor) setOptions.color = saved.color as Color;
      if (saved.finish !== targetFinish) setOptions.finish = saved.finish;
      if (saved.accessories !== core.state.accessories) {
        setOptions.accessories = saved.accessories.map((wear) =>
          wear.color === null ? wear.id : { id: wear.id, color: wear.color },
        );
      }
      if (!clayEqual(saved.clay, targetClay)) setOptions.clay = saved.clay;
      if (saved.eye !== eyeSpec) setOptions.eye = saved.eye;
      if (saved.paper !== paperSpec) setOptions.paper = saved.paper;
    }
    if (saved.face !== core.state.face) setOptions.face = saved.face;
    if (Object.keys(setOptions).length) set(setOptions);
    if (saved.status !== core.state.status) status(saved.status);
    if (saved.followSpec !== null) follow(saved.followSpec, saved.followOptions);
    else {
      if (controller) follow(null);
      lookAt(saved.look);
    }
  }

  const momentRunner: MomentRunner = createMomentRunner({
    now: () => time,
    apply: applyBeat,
    applyCue,
    capture: captureMoment,
    restore: restoreMoment,
    emitStart: (name) => core.momentStart(name),
    emitBeat: (name, index) => core.momentBeat(name, index),
    emitEnd: (name, status) => core.momentEnd(name, status),
  });

  function define(
    name: string,
    definition: MomentDefinition,
    options: MomentDefinitionOptions = {},
  ): void {
    assertAlive();
    registerLocal(localMoments, name, definition, options);
  }

  function run(
    name: string,
    params: MomentParams = {},
    options: MomentRunOptions = {},
  ): Promise<MomentResult> {
    assertAlive();
    const entry = lookupMoment(name, localMoments);
    if (!entry) throw unknownMoment(name, localMoments);
    const beats =
      typeof entry.def === 'function' ? entry.def(params) : entry.def;
    const restore = options.restore ?? entry.defaultRestore;
    return momentRunner.run(beats, name, { ...options, restore });
  }

  function moment(): MomentBuilder {
    assertAlive();
    return createMomentBuilder((beats, options) =>
      momentRunner.run(beats, 'inline', { ...options, restore: options.restore ?? false }),
    );
  }

  function stop(): void {
    assertAlive();
    momentRunner.stop();
  }

  function set(next: BlubSetOptions, setOptions: { duration?: number } = {}): void {
    assertAlive();
    const duration = durationOption(setOptions.duration, transitionDuration);
    const nextShape = next.shape === undefined ? undefined : requireShape(next.shape);
    const nextFace = next.face === undefined ? undefined : requireFace(next.face);
    const nextFinish = next.finish === undefined ? undefined : requireFinish(next.finish);
    const nextColor = next.color === undefined ? undefined : colorHex(requireColor(next.color));
    const nextClay = next.clay === undefined ? targetClay : mergeClay(targetClay, next.clay);
    const nextEye = next.eye === undefined ? eyeSpec : next.eye;
    const nextPaper = next.paper === undefined ? paperSpec : next.paper;
    // Validate eye/paper before mutating anything.
    resolveAux(nextEye, nextColor ?? targetColor);
    resolveAux(nextPaper, nextColor ?? targetColor);

    const coreOptions: BlubSetOptions = {};
    if (nextShape !== undefined) coreOptions.shape = nextShape;
    if (nextFace !== undefined) coreOptions.face = nextFace;
    if (nextFinish !== undefined) coreOptions.finish = nextFinish;
    if (next.accessories !== undefined) coreOptions.accessories = next.accessories;
    if (nextColor !== undefined) coreOptions.color = nextColor as Color;

    if (nextColor !== undefined) targetColor = nextColor;
    if (nextFinish !== undefined) targetFinish = nextFinish;
    targetClay = nextClay;
    eyeSpec = nextEye;
    paperSpec = nextPaper;

    core.set(coreOptions);
    styleTransition.set(targetStyle(), time, reducedMotion() ? 0 : duration);
    applyStyle();
    view.render(time);
  }

  function status(next: Status): void {
    assertAlive();
    core.status(next);
    applyStyle();
    view.render(time);
  }

  function play(action: Action, playOptions: { interrupt?: boolean } = {}): Promise<PlayResult> {
    assertAlive();
    const promise = core.play(action, playOptions);
    applyStyle();
    view.render(time);
    return promise;
  }

  function send(command: BlubCommand | BlubCommand[]): void {
    assertAlive();
    const rawCommands = Array.isArray(command) ? command : [command];
    const commands = rawCommands.map((item) => {
      const type = item !== null && typeof item === 'object' ? (item as { type?: unknown }).type : undefined;
      if (type === 'run' || type === 'stop' || type === 'define') {
        return validateMomentCommand(item);
      }
      return validateCommand(item);
    });
    for (const item of commands) {
      if (item.type === 'run') {
        void run(item.moment, item.params ?? {}, {
          restore: item.restore,
          queue: item.queue,
        });
      } else if (item.type === 'stop') {
        stop();
      } else if (item.type === 'define') {
        define(item.name, item.beats, { restore: item.restore });
      } else if (item.type === 'follow') {
        const { type: _type, target, ...rest } = item;
        follow(target as FollowSpec, rest);
      } else if (item.type === 'set') {
        const { type: _type, ...rest } = item;
        set(rest);
      } else {
        core.send(item);
      }
    }
  }

  function tick(deltaSeconds: number): void {
    assertAlive();
    if (!finite(deltaSeconds) || deltaSeconds < 0) {
      throw new TypeError('tick expects a finite, non-negative number of seconds.');
    }
    time += deltaSeconds;
    epochMs = clockNow();
    renderFrame();
  }

  function render(seconds: number): void {
    assertAlive();
    if (!finite(seconds) || seconds < 0) {
      throw new TypeError('render expects a finite, non-negative time in seconds.');
    }
    time = seconds;
    epochMs = clockNow();
    renderFrame();
  }

  function pause(): void {
    assertAlive();
    if (manual) return;
    time = Math.max(0, (clockNow() - epochMs) / 1000);
    userPaused = true;
    stopLoop();
  }

  function resume(): void {
    assertAlive();
    if (manual) return;
    userPaused = false;
    epochMs = clockNow() - time * 1000;
    startLoop();
  }

  const onVisibility = (): void => {
    hidden = document.hidden === true;
    if (hidden) stopLoop();
    else if (!userPaused) startLoop();
  };
  document.addEventListener('visibilitychange', onVisibility);
  disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const applyMotion = (): void => {
    model.setAmbient(!reducedMotion());
    applyStyle();
    view.render(time);
  };
  if (motionQuery && typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', applyMotion);
    disposers.push(() => motionQuery.removeEventListener('change', applyMotion));
  }

  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(svg);
    disposers.push(() => observer.disconnect());
  }

  if (options.signal) {
    const signal = options.signal;
    signal.addEventListener('abort', destroy, { once: true });
    disposers.push(() => signal.removeEventListener('abort', destroy));
  }

  if (DEV) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn(
        `createBlub: the container is ${rect.width}x${rect.height}px. Give it a size; the SVG is ${size}px.`,
      );
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    momentRunner.destroy();
    if (controller) {
      controller.destroy();
      controller = null;
    }
    while (disposers.length) disposers.pop()!();
    core.destroy();
    view.destroy();
  }

  startLoop();

  return {
    el: svg,
    get state(): Readonly<BlubState> {
      return core.state;
    },
    get time(): number {
      return time;
    },
    set,
    play,
    status,
    lookAt,
    follow,
    send,
    moment,
    define,
    run,
    stop,
    on: core.on,
    pause,
    resume,
    tick,
    render,
    destroy,
  };
}
