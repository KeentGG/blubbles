// Per-blub follow controller: resolves static or dynamic targets, applies radius
// gates, picks or blends gazes, and emits enter/leave/target events. It reads
// shared input facts once per frame and never reads layout unless invalidated.
import { acquireFollowInputs, followInputs } from './follow-inputs.js';
import { acquireMetric } from './element-metrics.js';
import type { Metrics } from './element-metrics.js';
import { createFollowGate, normalizeFollow } from './follow-gate.js';
import type { FollowGate, NormalizedFollow } from './follow-gate.js';
import {
  blendLook,
  createSelectState,
  selectStrongest,
  shapeGaze,
} from './follow-select.js';
import type { FollowCandidate, SelectState } from './follow-select.js';
import type {
  Action,
  Face,
  FollowEntry,
  FollowEntryInput,
  FollowOptions,
  FollowPoint,
  FollowRange,
  FollowSpec,
  FollowTarget,
  Status,
} from '../sdk/commands.js';

export interface FollowCallbacks {
  look(yaw: number, pitch: number, morph: number): void;
  enter(): void;
  leave(mode: 'previous' | 'wander' | 'center'): void;
  target(from: string | null, to: string | null): void;
}

export interface FollowFacts {
  status: Status;
  action: Action | null;
  face: Face;
  visible: boolean;
}

export interface FollowController {
  update(now: number): void;
  stop(): void;
  destroy(): void;
}

interface ResolvedEntry {
  target: FollowTarget;
  weight: number;
  radius: number | 'element' | undefined;
  exitRadius: number | undefined;
  onLeave: 'previous' | 'wander' | 'center';
  speed: number;
  range: FollowRange | undefined;
  mode: 'look' | 'avoid';
  delay: number;
  index: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function readRange(value: FollowRange | undefined): FollowRange | undefined {
  if (value === undefined) return undefined;
  if (!value || !finite(value.yaw) || !finite(value.pitch) || value.yaw < 0 || value.pitch < 0) {
    throw new TypeError('follow.range must be { yaw, pitch } in non-negative degrees.');
  }
  return { yaw: value.yaw, pitch: value.pitch };
}

function readSpeed(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!finite(value) || value <= 0) throw new TypeError('follow.speed must be a positive number.');
  return value;
}

function readDelay(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!finite(value) || value < 0) throw new TypeError('follow.delay must be a non-negative number of seconds.');
  return value;
}

function readOptions(options: FollowOptions): {
  pick: 'strongest' | 'blend';
  switchMargin: number;
  minHold: number;
} {
  const pick = options.pick ?? 'strongest';
  if (pick !== 'strongest' && pick !== 'blend') {
    throw new TypeError('follow.pick must be "strongest" or "blend".');
  }
  const switchMargin = options.switchMargin ?? 0.1;
  const minHold = options.minHold ?? 0.25;
  if (!finite(switchMargin) || switchMargin < 0) {
    throw new TypeError('follow.switchMargin must be a non-negative number.');
  }
  if (!finite(minHold) || minHold < 0) {
    throw new TypeError('follow.minHold must be a non-negative number of seconds.');
  }
  return { pick, switchMargin, minHold };
}

function makeEntry(
  item: FollowEntryInput,
  shared: FollowOptions,
  index: number,
  weight: number,
  total: number,
): ResolvedEntry {
  const isEntry =
    item !== null &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    !(item instanceof Element) &&
    !('el' in item) &&
    'target' in item;
  const entry = isEntry ? (item as FollowEntry) : null;
  const target = (isEntry ? entry!.target : (item as FollowTarget)) as FollowTarget;
  const source = entry ?? shared;
  const explicitWeight = entry?.weight ?? shared.weight;
  const resolvedWeight =
    explicitWeight ??
    (typeof item === 'string' && total > 1 ? (total - index) / total : weight);
  const onLeave = source.onLeave ?? shared.onLeave ?? 'previous';
  if (onLeave !== 'previous' && onLeave !== 'wander' && onLeave !== 'center') {
    throw new TypeError('follow.onLeave must be "previous", "wander" or "center".');
  }
  if ((source.radius !== undefined)) {
    normalizeFollow({ radius: source.radius, exitRadius: source.exitRadius, onLeave });
  }
  const mode = source.mode ?? shared.mode ?? 'look';
  if (mode !== 'look' && mode !== 'avoid') {
    throw new TypeError('follow.mode must be "look" or "avoid".');
  }
  return {
    target,
    weight: clamp01(resolvedWeight),
    radius: source.radius,
    exitRadius: source.exitRadius,
    onLeave,
    speed: readSpeed(source.speed ?? shared.speed),
    range: readRange(source.range ?? shared.range),
    mode,
    delay: readDelay(source.delay ?? shared.delay),
    index,
  };
}

const keyIds = new WeakMap<object, number>();
let nextKeyId = 1;
const keyOf = (value: object): string => {
  let id = keyIds.get(value);
  if (!id) {
    id = nextKeyId++;
    keyIds.set(value, id);
  }
  return `#${id}`;
};

const labelOf = (target: FollowTarget): string => {
  if (target === null) return 'none';
  if (typeof target === 'string') return target;
  if (typeof target === 'function') return 'function';
  if (target instanceof Element) {
    return target.id ? `#${target.id}` : target.tagName.toLowerCase();
  }
  if (typeof target === 'object' && 'el' in target) return 'blub';
  return 'target';
};

export function createFollowController(
  owner: SVGSVGElement,
  spec: FollowSpec,
  options: FollowOptions,
  callbacks: FollowCallbacks,
  facts: () => FollowFacts,
): FollowController {
  const config = readOptions(options);
  const state: SelectState = createSelectState();
  const releaseInputs = acquireFollowInputs();
  const gates = new Map<string, FollowGate>();
  const metricCache = new Map<Element, Metrics>();
  const selectorCache = new Map<string, Element>();
  let active = false;
  let destroyed = false;
  let rectRevision = -1;
  let leaveMode: 'previous' | 'wander' | 'center' = options.onLeave ?? 'previous';
  let lastUpdate = 0;
  let measureUsed = new Set<Element>();
  let currentTarget: FollowTarget | null = null;
  let currentWeight = 0;
  let currentSince = 0;

  const sharedRadius =
    options.radius === undefined
      ? null
      : normalizeFollow({
          radius: options.radius,
          exitRadius: options.exitRadius,
          onLeave: options.onLeave,
        });
  const sharedGate: FollowGate | null = sharedRadius
    ? createFollowGate(sharedRadius)
    : null;
  const gateRect = { left: 0, top: 0, width: 0, height: 0 };

  type MutableContext = {
    time: number;
    dt: number;
    blub: {
      rect: { x: number; y: number; width: number; height: number };
      center: { x: number; y: number };
      status: Status;
      action: Action | null;
      face: Face;
      visible: boolean;
    };
    pointer: {
      x: number;
      y: number;
      speed: number;
      distance: number;
      inside: boolean;
      active: boolean;
      idle: number;
      down: boolean;
      type: 'mouse' | 'pen' | 'touch';
    };
    focus: { el: Element | null; typing: boolean; idle: number };
    caret: FollowPoint | null;
    current: { target: FollowTarget | null; weight: number; since: number };
    gaze: { yaw: number; pitch: number };
    measure(el: Element): { x: number; y: number; distance: number; visible: boolean } | null;
  };

  const ctx: MutableContext = {
    time: 0,
    dt: 0,
    blub: {
      rect: { x: 0, y: 0, width: 0, height: 0 },
      center: { x: 0, y: 0 },
      status: 'idle',
      action: null,
      face: 'neutral',
      visible: true,
    },
    pointer: {
      x: 0,
      y: 0,
      speed: 0,
      distance: 0,
      inside: false,
      active: false,
      idle: Number.POSITIVE_INFINITY,
      down: false,
      type: 'mouse',
    },
    focus: { el: null, typing: false, idle: Number.POSITIVE_INFINITY },
    caret: null,
    current: { target: null, weight: 0, since: 0 },
    gaze: { yaw: 0, pitch: 0 },
    measure(element: Element): { x: number; y: number; distance: number; visible: boolean } | null {
      if (!element.isConnected) return null;
      measureUsed.add(element);
      let metric = metricCache.get(element);
      if (!metric) {
        metric = acquireMetric(element);
        metricCache.set(element, metric);
      }
      const rect = metric.cached;
      if (!rect) return null;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return {
        x,
        y,
        distance: Math.hypot(x - ctx.blub.center.x, y - ctx.blub.center.y),
        visible: metric.cachedVisible,
      };
    },
  };

  const DELAY_SLOTS = 600;
  const delayTimes = new Float64Array(DELAY_SLOTS);
  const delayYaw = new Float64Array(DELAY_SLOTS);
  const delayPitch = new Float64Array(DELAY_SLOTS);
  let delayIndex = 0;
  let delayCount = 0;

  const ownerRect = (): void => {
    const inputs = followInputs();
    if (rectRevision !== inputs.layout) {
      rectRevision = inputs.layout;
      const rect = owner.getBoundingClientRect();
      ctx.blub.rect.x = rect.left;
      ctx.blub.rect.y = rect.top;
      ctx.blub.rect.width = rect.width;
      ctx.blub.rect.height = rect.height;
      ctx.blub.center.x = rect.left + rect.width / 2;
      ctx.blub.center.y = rect.top + rect.height / 2;
      gateRect.left = rect.left;
      gateRect.top = rect.top;
      gateRect.width = rect.width;
      gateRect.height = rect.height;
    }
  };

  const dirFromPoint = (point: FollowPoint): { yaw: number; pitch: number } => {
    const halfWidth = ctx.blub.rect.width / 2 || 1;
    const halfHeight = ctx.blub.rect.height / 2 || 1;
    const nx = Math.max(-1, Math.min(1, (point.x - ctx.blub.center.x) / halfWidth));
    const ny = Math.max(-1, Math.min(1, (point.y - ctx.blub.center.y) / halfHeight));
    return { yaw: 16 * nx, pitch: -13 * ny };
  };

  const metricFor = (element: Element, used: Set<Element>): Metrics | null => {
    if (!element.isConnected) return null;
    used.add(element);
    let metric = metricCache.get(element);
    if (!metric) {
      metric = acquireMetric(element);
      metricCache.set(element, metric);
    }
    return metric;
  };

  const resolveElement = (target: string | Element): Element | null => {
    if (target instanceof Element) return target;
    const cached = selectorCache.get(target);
    if (cached && cached.isConnected) return cached;
    if (typeof document === 'undefined') return null;
    const found = document.querySelector(target);
    if (found) selectorCache.set(target, found);
    else selectorCache.delete(target);
    return found;
  };

  const dynamicEntries = (result: unknown): FollowEntryInput[] | null => {
    if (Array.isArray(result)) return result as FollowEntryInput[];
    return null;
  };

  const pointResult = (result: unknown): FollowPoint | null => {
    if (result && typeof result === 'object' && 'x' in result && 'y' in result) {
      const point = result as FollowPoint;
      if (finite(point.x) && finite(point.y)) return point;
    }
    return null;
  };

  const buildEntries = (): ResolvedEntry[] => {
    let list: FollowEntryInput[];
    if (typeof spec === 'function') {
      const result = spec(ctx);
      const dynamic = dynamicEntries(result);
      if (dynamic) list = dynamic;
      else {
        const point = pointResult(result);
        list = point ? [{ target: () => point }] : [];
      }
    } else if (Array.isArray(spec)) {
      list = spec;
    } else {
      list = [spec as FollowEntryInput];
    }
    const total = list.length;
    return list.map((item, index) => makeEntry(item, options, index, 1, total));
  };

  const resolveCandidate = (
    entry: ResolvedEntry,
    used: Set<Element>,
    inputs: ReturnType<typeof followInputs>,
  ): FollowCandidate | null => {
    const target = entry.target;
    let point: FollowPoint | null = null;
    let activeTarget = false;
    let key = '';
    let label = '';

    if (target === null) return null;
    if (typeof target === 'string') {
      if (target === 'pointer') {
        if (!inputs.pointer.windowInside) return null;
        point = { x: inputs.pointer.x, y: inputs.pointer.y };
        activeTarget = true;
        key = 'pointer';
        label = 'pointer';
      } else if (target === 'focus') {
        const focus = inputs.focus.el;
        if (!focus) return null;
        const metric = metricFor(focus, used);
        if (!metric || !metric.visible) return null;
        point = {
          x: metric.rect.left + metric.rect.width / 2,
          y: metric.rect.top + metric.rect.height / 2,
        };
        activeTarget = true;
        key = `focus:${keyOf(focus)}`;
        label = focus.id ? `focus#${focus.id}` : 'focus';
      } else if (target === 'caret') {
        if (!inputs.caret) return null;
        point = { x: inputs.caret.x, y: inputs.caret.y };
        activeTarget = true;
        key = 'caret';
        label = 'caret';
      } else {
        const element = resolveElement(target);
        if (!element || !element.isConnected) return null;
        const metric = metricFor(element, used);
        if (!metric || !metric.visible) return null;
        point = {
          x: metric.rect.left + metric.rect.width / 2,
          y: metric.rect.top + metric.rect.height / 2,
        };
        activeTarget = true;
        key = `selector:${target}`;
        label = target;
      }
    } else if (typeof target === 'function') {
      const result = target(ctx);
      const dynamic = dynamicEntries(result);
      const resolved = dynamic ? pointResult(dynamic[0]) : pointResult(result);
      if (!resolved) return null;
      point = resolved;
      activeTarget = true;
      key = `fn:${entry.index}`;
      label = 'function';
    } else if (target instanceof Element) {
      if (!target.isConnected) return null;
      const metric = metricFor(target, used);
      if (!metric || !metric.visible) return null;
      point = {
        x: metric.rect.left + metric.rect.width / 2,
        y: metric.rect.top + metric.rect.height / 2,
      };
      activeTarget = true;
      key = `el:${keyOf(target)}`;
      label = labelOf(target);
    } else if (typeof target === 'object' && 'el' in target) {
      const element = target.el;
      if (!element.isConnected) return null;
      const metric = metricFor(element, used);
      if (!metric || !metric.visible) return null;
      point = {
        x: metric.rect.left + metric.rect.width / 2,
        y: metric.rect.top + metric.rect.height / 2,
      };
      activeTarget = true;
      key = `blub:${keyOf(target)}`;
      label = 'blub';
    } else {
      return null;
    }

    if (!activeTarget || !point) return null;

    if (entry.radius !== undefined) {
      const gateKey = `${entry.index}:${key}:${String(entry.radius)}:${String(entry.exitRadius)}:${entry.onLeave}`;
      let gate = gates.get(gateKey);
      if (!gate) {
        const normalized: NormalizedFollow = normalizeFollow({
          radius: entry.radius,
          exitRadius: entry.exitRadius,
          onLeave: entry.onLeave,
        });
        gate = createFollowGate(normalized);
        gates.set(gateKey, gate);
      }
      if (!inputs.pointer.windowInside) gate.leave();
      else gate.update(inputs.pointer.x, inputs.pointer.y, gateRect);
      if (!gate.inside) return null;
    }

    const direction = shapeGaze(
      dirFromPoint(point).yaw,
      dirFromPoint(point).pitch,
      entry.range,
      entry.mode,
    );
    return {
      key,
      label,
      weight: entry.weight,
      active: true,
      yaw: direction.yaw,
      pitch: direction.pitch,
    };
  };

  const delayed = (yaw: number, pitch: number, now: number, delay: number): { yaw: number; pitch: number } => {
    if (delay <= 0) return { yaw, pitch };
    const slot = delayIndex % DELAY_SLOTS;
    delayIndex++;
    delayCount = Math.min(delayCount + 1, DELAY_SLOTS);
    delayTimes[slot] = now;
    delayYaw[slot] = yaw;
    delayPitch[slot] = pitch;
    const wanted = now - delay;
    let best = -1;
    let bestTime = -Infinity;
    for (let i = 0; i < delayCount; i++) {
      const t = delayTimes[i];
      if (t <= wanted && t > bestTime) {
        bestTime = t;
        best = i;
      }
    }
    if (best < 0) return { yaw, pitch };
    return { yaw: delayYaw[best], pitch: delayPitch[best] };
  };

  function update(now: number): void {
    if (destroyed) return;
    const inputs = followInputs();
    const dt = lastUpdate ? now - lastUpdate : 0;
    lastUpdate = now;
    ownerRect();
    const factsNow = facts();

    ctx.time = now;
    ctx.dt = dt;
    ctx.blub.status = factsNow.status;
    ctx.blub.action = factsNow.action;
    ctx.blub.face = factsNow.face;
    ctx.blub.visible = factsNow.visible;

    ctx.pointer.x = inputs.pointer.x;
    ctx.pointer.y = inputs.pointer.y;
    ctx.pointer.speed = inputs.pointer.speed;
    ctx.pointer.idle = inputs.pointer.idle;
    ctx.pointer.active = inputs.pointer.active;
    ctx.pointer.down = inputs.pointer.down;
    ctx.pointer.type = inputs.pointer.type;
    ctx.pointer.distance = Math.hypot(
      inputs.pointer.x - ctx.blub.center.x,
      inputs.pointer.y - ctx.blub.center.y,
    );
    let inside = inputs.pointer.windowInside;
    if (sharedGate) {
      if (!inputs.pointer.windowInside) sharedGate.leave();
      else sharedGate.update(inputs.pointer.x, inputs.pointer.y, gateRect);
      inside = sharedGate.inside;
    }
    ctx.pointer.inside = inside;
    ctx.focus.el = inputs.focus.el;
    ctx.focus.typing = inputs.focus.typing;
    ctx.focus.idle = inputs.focus.idle;
    ctx.caret = inputs.caret;

    const used = new Set<Element>();
    measureUsed = used;
    const entries = buildEntries();
    const candidates: FollowCandidate[] = [];
    const candidateEntries: ResolvedEntry[] = [];
    for (const entry of entries) {
      const candidate = resolveCandidate(entry, used, inputs);
      if (candidate) {
        candidates.push(candidate);
        candidateEntries.push(entry);
      }
    }

    const live = candidates.length > 0;
    if (!live) {
      if (active) {
        active = false;
        callbacks.leave(leaveMode);
      }
      if (state.currentKey !== null) {
        const from = state.currentLabel;
        state.currentKey = null;
        state.currentLabel = null;
        callbacks.target(from, null);
      }
      currentTarget = null;
      currentWeight = 0;
      currentSince = now;
      ctx.current.target = null;
      ctx.current.weight = 0;
      ctx.current.since = 0;
      for (const [element, metric] of metricCache) {
        if (!used.has(element)) {
          metric.release();
          metricCache.delete(element);
        }
      }
      return;
    }

    if (!active) {
      active = true;
      callbacks.enter();
    }

    let look: { yaw: number; pitch: number } | null = null;
    let speed = 1;
    let delay = 0;
    if (config.pick === 'blend') {
      look = blendLook(candidates);
      let top = candidates[0];
      for (const candidate of candidates) {
        if (candidate.active && candidate.weight > top.weight) top = candidate;
      }
      const topIndex = candidates.indexOf(top);
      const topEntry = candidateEntries[topIndex] ?? entries[0];
      if (topEntry && currentTarget !== topEntry.target) {
        currentTarget = topEntry.target;
        currentWeight = top.weight;
        currentSince = now;
      } else if (topEntry) {
        currentWeight = top.weight;
      }
      if (look) {
        const entry = topEntry ?? entries[0];
        leaveMode = entry?.onLeave ?? leaveMode;
        speed = entry?.speed ?? options.speed ?? 1;
        delay = entry?.delay ?? options.delay ?? 0;
      }
    } else {
      const from = state.currentLabel;
      const result = selectStrongest(candidates, state, now, config);
      if (result.switched) callbacks.target(from, result.label);
      const chosenIndex = candidates.findIndex((candidate) => candidate.key === result.key);
      const chosen = chosenIndex >= 0 ? candidates[chosenIndex] : null;
      const chosenEntry = candidateEntries[chosenIndex] ?? entries[0];
      if (result.switched && chosenEntry) {
        currentTarget = chosenEntry.target;
        currentWeight = chosen?.weight ?? chosenEntry.weight;
        currentSince = now;
      } else if (chosen) {
        currentWeight = chosen.weight;
      }
      leaveMode = chosenEntry?.onLeave ?? leaveMode;
      speed = chosenEntry?.speed ?? options.speed ?? 1;
      delay = chosenEntry?.delay ?? options.delay ?? 0;
      if (chosen) look = { yaw: chosen.yaw, pitch: chosen.pitch };
    }

    ctx.current.target = currentTarget;
    ctx.current.weight = currentWeight;
    ctx.current.since = currentTarget ? now - currentSince : 0;

    if (look) {
      const delayedGaze = delayed(look.yaw, look.pitch, now, delay);
      ctx.gaze.yaw = delayedGaze.yaw;
      ctx.gaze.pitch = delayedGaze.pitch;
      callbacks.look(delayedGaze.yaw, delayedGaze.pitch, 0.24 / speed);
    }

    for (const [element, metric] of metricCache) {
      if (!used.has(element)) {
        metric.release();
        metricCache.delete(element);
      }
    }
  }

  function stop(): void {
    if (destroyed) return;
    if (active) {
      active = false;
      callbacks.leave(leaveMode);
    }
    if (state.currentKey !== null) {
      const from = state.currentLabel;
      state.currentKey = null;
      state.currentLabel = null;
      callbacks.target(from, null);
    }
    destroy();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    releaseInputs();
    for (const metric of metricCache.values()) metric.release();
    metricCache.clear();
    gates.clear();
    selectorCache.clear();
  }

  return { update, stop, destroy };
}
