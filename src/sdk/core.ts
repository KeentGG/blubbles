// The SDK state machine: statuses, action queue, promises and events. It owns no
// DOM and no clock, so it runs under a fake clock in node:test and under the shared
// frame scheduler live.
import { normalizeAccessories } from './accessories.js';
import { STATE_BY_ID } from '../catalog/states.js';
import type { BlubModel } from '../internal/model.js';
import {
  ACTION_STATES,
  STATUS_STATES,
  validateCommand,
  requireAction,
  requireFinish,
  requireStatus,
} from './commands.js';
import { requireColor, requireFace, requireShape } from '../resolve.js';
import type {
  Action,
  BlubCommand,
  BlubEvents,
  BlubSetOptions,
  BlubState,
  Face,
  Finish,
  PlayResult,
  PlayStatus,
  Shape,
  Status,
} from './commands.js';

interface QueuedAction {
  action: Action;
  resolve: (result: PlayResult) => void;
}

interface RunningAction extends QueuedAction {
  endAt: number;
}

type Listener = (event: BlubEvents[keyof BlubEvents]) => void;

export interface BlubCoreOptions {
  status?: Status;
}

export interface BlubCore {
  readonly time: number;
  readonly state: Readonly<BlubState>;
  tick(seconds: number): void;
  play(action: Action, options?: { interrupt?: boolean }): Promise<PlayResult>;
  status(status: Status): void;
  set(options: BlubSetOptions): void;
  send(command: BlubCommand | BlubCommand[]): void;
  look(yaw: number, pitch: number, morph?: number): void;
  resetLook(): void;
  on<K extends keyof BlubEvents>(
    event: K,
    listener: (event: BlubEvents[K]) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
  followEntered(): void;
  followLeft(): void;
  followTarget(from: string | null, to: string | null): void;
  momentStart(name: string): void;
  momentBeat(name: string, index: number): void;
  momentEnd(name: string, status: PlayStatus): void;
  cancelAction(action: Action): boolean;
  destroy(): void;
}

export function createBlubCore(model: BlubModel, options: BlubCoreOptions = {}): BlubCore {
  let time = 0;
  let statusName = requireStatus(options.status ?? 'idle');
  let current: RunningAction | null = null;
  const queue: QueuedAction[] = [];
  let destroyed = false;

  const listeners = {
    'action:end': new Set<Listener>(),
    'status:change': new Set<Listener>(),
    'follow:enter': new Set<Listener>(),
    'follow:leave': new Set<Listener>(),
    'follow:target': new Set<Listener>(),
    'moment:start': new Set<Listener>(),
    'moment:beat': new Set<Listener>(),
    'moment:end': new Set<Listener>(),
    change: new Set<Listener>(),
  };

  model.play(STATUS_STATES[statusName], 0);

  function assertAlive(): void {
    if (destroyed) throw new Error('This blub has been destroyed.');
  }

  function snapshot(): Readonly<BlubState> {
    return Object.freeze({
      shape: model.shape as Shape,
      face: model.face as Face,
      color: model.color,
      finish: model.finish as Finish,
      accessories: model.accessories,
      status: statusName,
      action: current?.action ?? null,
    });
  }

  function emit<K extends keyof BlubEvents>(event: K, payload: BlubEvents[K]): void {
    for (const listener of [...listeners[event]]) {
      try {
        listener(payload);
      } catch (error) {
        console.error('[blubbles] event listener failed', error);
      }
    }
  }

  function emitChange(): void {
    emit('change', snapshot());
  }

  function startAction(action: Action, resolve: (result: PlayResult) => void): void {
    model.play(ACTION_STATES[action], time);
    const state = STATE_BY_ID.get(ACTION_STATES[action])!;
    current = { action, resolve, endAt: time + state.duration };
    emitChange();
  }

  function finishCurrent(status: PlayResult['status']): void {
    const finished = current;
    if (!finished) return;
    current = null;
    // Settle the promise and move the queue before anyone observes the event.
    finished.resolve({ status });
    if (status === 'completed') {
      const next = queue.shift();
      if (next) startAction(next.action, next.resolve);
      else model.play(STATUS_STATES[statusName], time);
    } else {
      const queued = queue.splice(0);
      for (const next of queued) next.resolve({ status: 'cancelled' });
    }
    emit('action:end', { action: finished.action, interrupted: status !== 'completed' });
    emitChange();
  }

  function interrupt(): void {
    finishCurrent('interrupted');
  }

  function finishDue(): void {
    while (current && time >= current.endAt) {
      finishCurrent('completed');
    }
  }

  function play(
    action: Action,
    playOptions: { interrupt?: boolean } = {},
  ): Promise<PlayResult> {
    assertAlive();
    const validAction = requireAction(action);
    if (playOptions.interrupt) interrupt();
    return new Promise((resolve) => {
      if (current && !playOptions.interrupt) queue.push({ action: validAction, resolve });
      else startAction(validAction, resolve);
    });
  }

  function status(status: Status): void {
    assertAlive();
    const next = requireStatus(status);
    const previous = statusName;
    const hadAction = current !== null;
    if (hadAction) interrupt();
    statusName = next;
    if (previous !== next) emit('status:change', { status: next, previous });
    if (hadAction || previous !== next) {
      model.play(STATUS_STATES[next], time);
      emitChange();
    }
  }

  function set(options: BlubSetOptions): void {
    assertAlive();
    if (options.shape !== undefined) model.setShape(requireShape(options.shape), time);
    if (options.face !== undefined) model.setFace(requireFace(options.face), time);
    if (options.color !== undefined) model.setColor(requireColor(options.color));
    if (options.finish !== undefined) model.setFinish(requireFinish(options.finish));
    if (options.accessories !== undefined) {
      model.setAccessories(normalizeAccessories(options.accessories), time);
    }
    emitChange();
  }

  function send(command: BlubCommand | BlubCommand[]): void {
    assertAlive();
    const commands = (Array.isArray(command) ? command : [command]).map(validateCommand);
    for (const item of commands) {
      if (item.type === 'play') {
        void play(item.action, item.interrupt ? { interrupt: true } : {});
      } else if (item.type === 'status') {
        status(item.status);
      } else if (item.type === 'set') {
        set(item);
      } else if (item.type === 'look') {
        look(item.yaw, item.pitch);
      }
      // follow commands are applied by createBlub, which owns the DOM.
    }
  }

  function look(yaw: number, pitch: number, morph?: number): void {
    assertAlive();
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
      throw new TypeError('look expects finite yaw and pitch numbers.');
    }
    model.look({ yaw, pitch }, time, morph);
  }

  function resetLook(): void {
    if (!destroyed) model.look(null, time);
  }

  function tick(seconds: number): void {
    assertAlive();
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new TypeError('tick expects a finite, non-negative number of seconds.');
    }
    time = seconds;
    finishDue();
  }

  function on<K extends keyof BlubEvents>(
    event: K,
    listener: (event: BlubEvents[K]) => void,
    eventOptions: { signal?: AbortSignal } = {},
  ): () => void {
    assertAlive();
    if (!(event in listeners)) {
      throw new TypeError(
        `Unknown event ${JSON.stringify(String(event))}. Valid events: "action:end", "status:change", "follow:enter", "follow:leave", "follow:target", "moment:start", "moment:beat", "moment:end", "change".`,
      );
    }
    const signal = eventOptions.signal;
    if (signal?.aborted) return () => {};
    const setForEvent = listeners[event] as Set<Listener>;
    const wrapped = listener as Listener;
    setForEvent.add(wrapped);
    const off = (): void => {
      setForEvent.delete(wrapped);
      signal?.removeEventListener('abort', off);
    };
    signal?.addEventListener('abort', off, { once: true });
    return off;
  }

  function followEntered(): void {
    if (!destroyed) emit('follow:enter', {});
  }

  function followLeft(): void {
    if (!destroyed) emit('follow:leave', {});
  }

  function followTarget(from: string | null, to: string | null): void {
    if (!destroyed) emit('follow:target', { from, to });
  }

  function momentStart(name: string): void {
    if (!destroyed) emit('moment:start', { name });
  }

  function momentBeat(name: string, index: number): void {
    if (!destroyed) emit('moment:beat', { name, index });
  }

  function momentEnd(name: string, status: PlayStatus): void {
    if (!destroyed) emit('moment:end', { name, status });
  }

  /** Cancel only the named running action; used by a moment that ends early. */
  function cancelAction(action: Action): boolean {
    if (destroyed || !current || current.action !== action) return false;
    const finished = current;
    current = null;
    finished.resolve({ status: 'cancelled' });
    model.play(STATUS_STATES[statusName], time);
    emit('action:end', { action: finished.action, interrupted: true });
    emitChange();
    return true;
  }

  function destroy(): void {
    if (destroyed) return;
    finishCurrent('cancelled');
    destroyed = true;
    listeners['action:end'].clear();
    listeners['status:change'].clear();
    listeners['follow:enter'].clear();
    listeners['follow:leave'].clear();
    listeners['follow:target'].clear();
    listeners['moment:start'].clear();
    listeners['moment:beat'].clear();
    listeners['moment:end'].clear();
    listeners.change.clear();
  }

  return {
    get time(): number {
      return time;
    },
    get state(): Readonly<BlubState> {
      return snapshot();
    },
    tick,
    play,
    status,
    set,
    send,
    look,
    resetLook,
    on,
    followEntered,
    followLeft,
    followTarget,
    momentStart,
    momentBeat,
    momentEnd,
    cancelAction,
    destroy,
  };
}
