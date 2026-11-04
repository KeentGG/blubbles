// Clock-driven moment scheduler. No timers and no DOM: the blub calls update()
// each frame, so manual clocks and fake-clock tests drive the same code.
import type { PlayResult, PlayStatus } from '../sdk/commands.js';
import type {
  MomentCue,
  MomentBeat,
  MomentResult,
  MomentRunOptions,
} from '../sdk/moments.js';

export interface MomentApply {
  promise: Promise<PlayResult>;
  cancel(): void;
}

export interface MomentHost {
  now(): number;
  apply(beat: MomentBeat): MomentApply | null;
  applyCue(cue: MomentCue): void;
  capture(): unknown;
  restore(snapshot: unknown, all: boolean): void;
  emitStart(name: string): void;
  emitBeat(name: string, index: number): void;
  emitEnd(name: string, status: PlayStatus): void;
}

interface QueuedRun {
  name: string;
  beats: MomentBeat[];
  options: MomentRunOptions;
  resolve: (result: MomentResult) => void;
  signalCleanup: (() => void) | null;
}

interface ActiveRun extends QueuedRun {
  index: number;
  startedAt: number;
  hold: number;
  wait: number;
  cues: MomentCue[];
  nextCue: number;
  maxCueAt: number;
  actionDone: boolean;
  actionStatus: PlayStatus;
  cancelAction: (() => void) | null;
  snapshot: unknown;
  restore: boolean | 'all';
}

export interface MomentRunner {
  run(
    beats: MomentBeat[],
    name: string,
    options?: MomentRunOptions,
  ): Promise<MomentResult>;
  stop(): void;
  destroy(): void;
  update(now: number): void;
}

const EPSILON = 1e-9;

const safeEmit = (action: () => void): void => {
  try {
    action();
  } catch (error) {
    console.error('[blubbles] moment listener failed', error);
  }
};

export function createMomentRunner(host: MomentHost): MomentRunner {
  let active: ActiveRun | null = null;
  const queue: QueuedRun[] = [];
  let destroyed = false;

  function detachSignal(run: QueuedRun): void {
    run.signalCleanup?.();
    run.signalCleanup = null;
  }

  function settleQueued(status: PlayStatus): void {
    const pending = queue.splice(0);
    for (const item of pending) {
      detachSignal(item);
      item.resolve({ status });
    }
  }

  function finishActive(status: PlayStatus, restore: boolean): void {
    const run = active;
    if (!run) return;
    active = null;
    detachSignal(run);
    if (status !== 'completed' && run.cancelAction) {
      try {
        run.cancelAction();
      } catch (error) {
        console.error('[blubbles] moment action cancel failed', error);
      }
    }
    run.cancelAction = null;
    if (restore && run.restore !== false && run.snapshot !== undefined) {
      try {
        host.restore(run.snapshot, run.restore === 'all');
      } catch (error) {
        console.error('[blubbles] moment restore failed', error);
      }
    }
    run.resolve({ status });
    safeEmit(() => host.emitEnd(run.name, status));
    if (active === null && queue.length && !destroyed) {
      begin(queue.shift()!);
    }
  }

  function startBeat(now: number): void {
    const run = active;
    if (!run) return;
    if (run.index >= run.beats.length) {
      finishActive('completed', true);
      return;
    }
    const beat = run.beats[run.index];
    run.startedAt = now;
    run.hold = beat.hold ?? 0;
    run.wait = beat.wait ?? 0;
    const cues = beat.cue === undefined ? [] : Array.isArray(beat.cue) ? [...beat.cue] : [beat.cue];
    cues.sort((a, b) => a.at - b.at);
    run.cues = cues;
    run.nextCue = 0;
    run.maxCueAt = cues.reduce((max, cue) => Math.max(max, cue.at), 0);
    run.actionDone = true;
    run.actionStatus = 'completed';
    safeEmit(() => host.emitBeat(run.name, run.index));
    if (active !== run) return;
    try {
      const applied = host.apply(beat);
      if (applied) {
        run.actionDone = false;
        run.cancelAction = applied.cancel;
        const token = run.index;
        applied.promise.then((result) => {
          if (active === run && run.index === token) {
            run.actionDone = true;
            run.actionStatus = result.status;
            run.cancelAction = null;
          }
        });
      }
    } catch (error) {
      console.error('[blubbles] moment beat failed', error);
      finishActive('cancelled', true);
    }
  }

  function fireCues(now: number): void {
    const run = active;
    if (!run) return;
    while (run.nextCue < run.cues.length) {
      const cue = run.cues[run.nextCue];
      if (now - run.startedAt + EPSILON < cue.at) break;
      run.nextCue++;
      try {
        host.applyCue(cue);
      } catch (error) {
        console.error('[blubbles] moment cue failed', error);
        finishActive('cancelled', true);
        return;
      }
    }
  }

  function update(now: number): void {
    if (destroyed) return;
    let guard = 0;
    while (active && guard++ < 1000) {
      const run = active;
      if (run.index < 0) {
        run.index = 0;
        startBeat(now);
        if (active !== run) return;
      }
      fireCues(now);
      if (active !== run) return;
      if (!run.actionDone) return;
      if (run.actionStatus !== 'completed') {
        finishActive(run.actionStatus, true);
        return;
      }
      const elapsed = now - run.startedAt;
      const required = Math.max(run.hold, run.wait, run.maxCueAt);
      if (elapsed + EPSILON < required) return;
      run.index++;
      if (run.index >= run.beats.length) {
        finishActive('completed', true);
        return;
      }
      startBeat(now);
      if (active !== run) return;
    }
  }

  function begin(item: QueuedRun): void {
    const restore = item.options.restore;
    const snapshot = restore === false ? undefined : host.capture();
    const run: ActiveRun = {
      ...item,
      index: -1,
      startedAt: host.now(),
      hold: 0,
      wait: 0,
      cues: [],
      nextCue: 0,
      maxCueAt: 0,
      actionDone: true,
      actionStatus: 'completed',
      cancelAction: null,
      snapshot,
      restore: restore ?? false,
    };
    detachSignal(item);
    active = run;
    safeEmit(() => host.emitStart(run.name));
    if (active !== run) return;
    const signal = run.options.signal;
    if (signal) {
      const abort = (): void => {
        if (active === run) finishActive('cancelled', true);
      };
      signal.addEventListener('abort', abort, { once: true });
      run.signalCleanup = () => signal.removeEventListener('abort', abort);
    }
  }

  function run(
    beats: MomentBeat[],
    name: string,
    options: MomentRunOptions = {},
  ): Promise<MomentResult> {
    if (destroyed) return Promise.resolve({ status: 'cancelled' });
    if (options.signal?.aborted) return Promise.resolve({ status: 'cancelled' });
    return new Promise((resolve) => {
      const item: QueuedRun = { name, beats, options, resolve, signalCleanup: null };
      if (active) {
        if (options.queue) {
          queue.push(item);
          const signal = options.signal;
          if (signal) {
            const abort = (): void => {
              const at = queue.indexOf(item);
              if (at >= 0) {
                queue.splice(at, 1);
                detachSignal(item);
                item.resolve({ status: 'cancelled' });
              }
            };
            signal.addEventListener('abort', abort, { once: true });
            item.signalCleanup = () => signal.removeEventListener('abort', abort);
          }
          return;
        }
        settleQueued('cancelled');
        finishActive('interrupted', true);
        let guard = 0;
        while (active && guard++ < 100) finishActive('interrupted', true);
      }
      if (!active && queue.length) {
        if (options.queue) {
          queue.push(item);
          const signal = options.signal;
          if (signal) {
            const abort = (): void => {
              const at = queue.indexOf(item);
              if (at >= 0) {
                queue.splice(at, 1);
                detachSignal(item);
                item.resolve({ status: 'cancelled' });
              }
            };
            signal.addEventListener('abort', abort, { once: true });
            item.signalCleanup = () => signal.removeEventListener('abort', abort);
          }
          return;
        }
        settleQueued('cancelled');
      }
      begin(item);
    });
  }

  function stop(): void {
    settleQueued('cancelled');
    if (active) finishActive('cancelled', true);
  }

  function destroy(): void {
    destroyed = true;
    if (active) finishActive('cancelled', false);
    settleQueued('cancelled');
  }

  return { run, stop, destroy, update };
}
