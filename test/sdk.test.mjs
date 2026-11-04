// SDK behaviour under a manual clock: queueing, promises, statuses, events and
// validation. No DOM and no rAF: createBlubCore is driven by tick().
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlubModel } from '../dist/internal/model.js';
import { createBlubCore } from '../dist/sdk/core.js';
import {
  ACTIONS,
  STATUSES,
  ACTION_STATES,
  STATUS_STATES,
  commandSchema,
} from '../dist/sdk/commands.js';
import { STATE_BY_ID } from '../dist/engine/index.js';

const make = (status = 'idle') => {
  const model = createBlubModel({
    shape: 'circle',
    face: 'neutral',
    color: 'blue',
    action: STATUS_STATES[status],
  });
  return createBlubCore(model, { status });
};

test('vocabulary covers every engine state exactly once', () => {
  assert.equal(ACTIONS.length, 10);
  assert.equal(STATUSES.length, 5);
  const mapped = [...Object.values(ACTION_STATES), ...Object.values(STATUS_STATES)];
  assert.equal(new Set(mapped).size, 15);
  assert.deepEqual(new Set(mapped), new Set(STATE_BY_ID.keys()));
  assert.equal(commandSchema.oneOf.length, 8);
});

test('state is a frozen snapshot', () => {
  const core = make();
  const state = core.state;
  assert.ok(Object.isFrozen(state));
  assert.deepEqual(state, {
    shape: 'circle',
    face: 'neutral',
    color: '#3b93f0',
    finish: 'clay',
    accessories: [],
    status: 'idle',
    action: null,
  });
});

test('set applies any subset and validates with suggestions', () => {
  const core = make();
  core.set({ color: '#7c5cff' });
  assert.equal(core.state.color, '#7c5cff');
  core.set({ face: 'excited', finish: 'flat', shape: 'pebble' });
  assert.equal(core.state.face, 'excited');
  assert.equal(core.state.finish, 'flat');
  assert.equal(core.state.shape, 'pebble');
  assert.throws(
    () => core.set({ face: 'hapy' }),
    /Unknown face "hapy"\. Did you mean "happy"\?/,
  );
});

test('plays queue in order and resolve with their result', async () => {
  const core = make();
  const ended = [];
  core.on('action:end', (event) => ended.push(event));
  const first = core.play('wink');
  const second = core.play('notify');
  core.tick(0);
  assert.equal(core.state.action, 'wink');
  core.tick(1.6);
  assert.deepEqual(await first, { status: 'completed' });
  assert.equal(core.state.action, 'notify');
  core.tick(3.81);
  assert.deepEqual(await second, { status: 'completed' });
  assert.equal(core.state.action, null);
  assert.equal(core.state.status, 'idle');
  assert.deepEqual(
    ended.map((event) => [event.action, event.interrupted]),
    [['wink', false], ['notify', false]],
  );
});

test('a direct play resolves when its action ends', async () => {
  const core = make();
  const done = core.play('hatch');
  core.tick(1.79);
  assert.equal(core.state.action, 'hatch');
  core.tick(1.8);
  assert.deepEqual(await done, { status: 'completed' });
  assert.equal(core.state.action, null);
});

test('interrupt cuts in; queued plays are cancelled', async () => {
  const core = make();
  const first = core.play('wink');
  const queued = core.play('notify');
  core.tick(0.5);
  const cutting = core.play('burst', { interrupt: true });
  assert.deepEqual(await first, { status: 'interrupted' });
  assert.deepEqual(await queued, { status: 'cancelled' });
  assert.equal(core.state.action, 'burst');
  core.tick(3.1);
  assert.deepEqual(await cutting, { status: 'completed' });
});

test('status holds and a play returns to it', async () => {
  const core = make();
  const changes = [];
  core.on('status:change', (event) => changes.push(event));
  core.status('thinking');
  core.tick(10);
  assert.equal(core.state.status, 'thinking');
  assert.equal(core.state.action, null);
  const wink = core.play('wink');
  core.tick(11.6);
  assert.deepEqual(await wink, { status: 'completed' });
  assert.equal(core.state.status, 'thinking');
  assert.equal(core.state.action, null);
  assert.deepEqual(changes, [{ status: 'thinking', previous: 'idle' }]);
});

test('status interrupts a running action and clears the queue', async () => {
  const core = make();
  const first = core.play('orbit');
  const queued = core.play('comet');
  core.tick(0.5);
  core.status('sleeping');
  assert.deepEqual(await first, { status: 'interrupted' });
  assert.deepEqual(await queued, { status: 'cancelled' });
  assert.equal(core.state.status, 'sleeping');
  assert.equal(core.state.action, null);
});

test('change fires for set, play start/end and status', async () => {
  const core = make();
  const states = [];
  core.on('change', (state) => states.push(state));
  core.set({ shape: 'cloud' });
  core.status('alert');
  const wink = core.play('wink');
  core.tick(1.6);
  await wink;
  assert.ok(states.length >= 4);
  assert.equal(states[0].shape, 'cloud');
  assert.equal(states.at(-1).action, null);
});

test('send validates every command before applying any', () => {
  const core = make();
  core.status('thinking');
  assert.throws(
    () =>
      core.send([
        { type: 'status', status: 'idle' },
        { type: 'set', shape: 'nope' },
      ]),
    /Unknown shape "nope"/,
  );
  assert.equal(core.state.status, 'thinking');
  core.send([
    { type: 'set', color: 'pink' },
    { type: 'status', status: 'alert' },
    { type: 'look', yaw: 4, pitch: -2 },
  ]);
  assert.equal(core.state.color, '#e152b0');
  assert.equal(core.state.status, 'alert');
});

test('invalid commands name the value, list valid ones and suggest', () => {
  const core = make();
  assert.throws(() => core.send({ type: 'plays' }), /Did you mean "play"\?/);
  assert.throws(
    () => core.send({ type: 'play', action: 'dance' }),
    /Unknown action "dance"\..*Valid actions: "wink", "notify", "exclaim"/,
  );
  assert.throws(
    () => core.send({ type: 'status', status: 'sleepin' }),
    /Unknown status "sleepin"\. Did you mean "sleeping"\?/,
  );
  assert.throws(() => core.send({ type: 'look', yaw: NaN, pitch: 0 }), /finite number/);
  assert.throws(() => core.send({ type: 'follow', target: [{ target: 1 }] }), /string target/);
  assert.doesNotThrow(() =>
    core.send({ type: 'follow', target: ['caret', { target: '#chat', weight: 0.5 }], pick: 'blend' }),
  );
});

test('on returns an unsubscribe and accepts a signal', () => {
  const core = make();
  let calls = 0;
  const off = core.on('change', () => calls++);
  core.set({ color: 'red' });
  off();
  core.set({ color: 'green' });
  assert.equal(calls, 1);

  const controller = new AbortController();
  core.on('change', () => calls++, { signal: controller.signal });
  controller.abort();
  core.set({ color: 'amber' });
  assert.equal(calls, 1);
});

test('destroy settles pending promises, is idempotent and rejects later calls', async () => {
  const core = make();
  const running = core.play('orbit');
  const queued = core.play('comet');
  core.destroy();
  assert.deepEqual(await running, { status: 'cancelled' });
  assert.deepEqual(await queued, { status: 'cancelled' });
  core.destroy();
  assert.throws(() => core.play('wink'), /destroyed/);
  assert.throws(() => core.tick(1), /destroyed/);
});

test('clay clamps and merges partially', async () => {
  const { normalizeClay, mergeClay, DEFAULT_CLAY } = await import('../dist/sdk/clay.js');
  const base = normalizeClay();
  assert.deepEqual(base, DEFAULT_CLAY);
  const hot = normalizeClay(3);
  assert.equal(hot.highlight, 2);
  assert.equal(hot.shadow, 2);
  const clamped = normalizeClay({ highlight: -1, shadow: 3, light: { x: 0.5 } });
  assert.equal(clamped.highlight, 0);
  assert.equal(clamped.shadow, 2);
  assert.equal(clamped.light.x, 0.5);
  assert.equal(clamped.light.y, -0.4);
  const merged = mergeClay(base, { highlight: 0.5 });
  assert.equal(merged.highlight, 0.5);
  assert.equal(merged.shadow, 1);
  assert.deepEqual(merged.light, base.light);
  const shorthand = mergeClay(base, 0.6);
  assert.equal(shorthand.highlight, 0.6);
  assert.equal(shorthand.shadow, 0.6);
  assert.throws(() => normalizeClay({ highlight: NaN }), /finite number/);
});

test('style transition starts, interpolates, snaps and interrupts', async () => {
  const { createStyleTransition } = await import('../dist/internal/style-transition.js');
  const clay = { highlight: 1, shadow: 1, light: { x: -0.32, y: -0.4 } };
  const a = { color: '#3b93f0', paper: '#0a0a0c', eye: '#ffffff', finish: 'clay', clay };
  const b = { color: '#f0b429', paper: '#ffffff', eye: '#0a0a0c', finish: 'clay', clay: { highlight: 0, shadow: 2, light: { x: 0, y: 0.2 } } };
  const transition = createStyleTransition(a);
  transition.set(b, 0, 1);
  assert.equal(transition.at(0).color, a.color);
  const mid = transition.at(0.5);
  assert.notEqual(mid.color, a.color);
  assert.notEqual(mid.color, b.color);
  assert.equal(mid.clay.highlight, 0.5);
  assert.equal(mid.clay.shadow, 1.5);
  assert.equal(transition.at(1).color, b.color);
  assert.deepEqual(transition.at(1).clay, b.clay);

  const interruptedAt = transition.at(0.4).color;
  const c = { ...b, color: '#e152b0' };
  transition.set(c, 0.4, 1);
  assert.equal(transition.at(0.4).color, interruptedAt);
  assert.equal(transition.at(1.4).color, c.color);
  transition.jump(a);
  assert.equal(transition.at(0.4).color, a.color);
});

test('follow gate has radius hysteresis and element mode', async () => {
  const { normalizeFollow, createFollowGate } = await import('../dist/internal/follow-gate.js');
  const rect = { left: 0, top: 0, width: 200, height: 200 };
  const gate = createFollowGate(normalizeFollow({ radius: 100 }));
  assert.equal(gate.update(100, 100, rect), 'enter');
  assert.equal(gate.update(100, 210, rect), 'move');   // 110px, inside the 125px exit
  assert.equal(gate.update(100, 226, rect), 'leave');  // 126px
  assert.equal(gate.update(100, 180, rect), 'enter');  // re-enter within 100px
  assert.equal(gate.update(100, 100, rect), 'move');
  assert.equal(gate.leave(), true);
  assert.equal(gate.leave(), false);

  const elementGate = createFollowGate(normalizeFollow({ radius: 'element' }));
  assert.equal(elementGate.update(50, 50, rect), 'enter');
  assert.equal(elementGate.update(220, 50, rect), 'leave');
  assert.equal(elementGate.update(220, 50, rect), 'none');

  const anywhere = createFollowGate(normalizeFollow({}));
  assert.equal(anywhere.update(9999, 9999, rect), 'enter');
  assert.equal(anywhere.update(9999, 9999, rect), 'move');

  assert.throws(() => normalizeFollow({ radius: 100, exitRadius: 90 }), />= radius/);
  assert.throws(() => normalizeFollow({ radius: 'element', exitRadius: 10 }), /only applies/);
  assert.throws(() => normalizeFollow({ onLeave: 'hop' }), /onLeave/);
});

test('follow priority falls through inactive targets', async () => {
  const { selectStrongest, createSelectState } = await import('../dist/internal/follow-select.js');
  const state = createSelectState();
  const options = { pick: 'strongest', switchMargin: 0.1, minHold: 0.25 };
  const candidates = [
    { key: 'caret', label: 'caret', weight: 1, active: false, yaw: 0, pitch: 0 },
    { key: 'focus', label: 'focus', weight: 0.66, active: true, yaw: 4, pitch: 2 },
    { key: 'pointer', label: 'pointer', weight: 0.33, active: true, yaw: 8, pitch: 1 },
  ];
  assert.equal(selectStrongest(candidates, state, 0, options).key, 'focus');
  candidates[1].active = false; // element removed / focus left
  const next = selectStrongest(candidates, state, 0.1, options);
  assert.equal(next.key, 'pointer');
  assert.equal(next.switched, true);
});

test('weighted winner needs margin and minHold; equal weights do not flicker', async () => {
  const { selectStrongest, createSelectState } = await import('../dist/internal/follow-select.js');
  const options = { pick: 'strongest', switchMargin: 0.1, minHold: 0.25 };
  const state = createSelectState();
  const list = (a, b) => [
    { key: 'a', label: 'a', weight: a, active: true, yaw: 0, pitch: 0 },
    { key: 'b', label: 'b', weight: b, active: true, yaw: 0, pitch: 0 },
  ];
  assert.equal(selectStrongest(list(0.5, 0.45), state, 0, options).key, 'a');
  assert.equal(selectStrongest(list(0.5, 0.5), state, 1, options).key, 'a');
  assert.equal(selectStrongest(list(0.5, 0.55), state, 2, options).key, 'a'); // below margin
  assert.equal(selectStrongest(list(0.5, 0.7), state, 3, options).key, 'a'); // lead starts
  assert.equal(selectStrongest(list(0.5, 0.7), state, 3.2, options).key, 'a'); // hold
  assert.equal(selectStrongest(list(0.5, 0.7), state, 3.3, options).key, 'b'); // switched
  assert.equal(selectStrongest(list(0.7, 0.7), state, 4, options).key, 'b'); // tie
});

test('blend averages weighted gaze and avoid/range shape it', async () => {
  const { blendLook, shapeGaze } = await import('../dist/internal/follow-select.js');
  const candidates = [
    { key: 'a', label: 'a', weight: 1, active: true, yaw: 10, pitch: 4 },
    { key: 'b', label: 'b', weight: 0.5, active: true, yaw: -4, pitch: 0 },
    { key: 'c', label: 'c', weight: 1, active: false, yaw: 100, pitch: 100 },
  ];
  const blended = blendLook(candidates);
  assert.ok(Math.abs(blended.yaw - (10 * 1 + -4 * 0.5) / 1.5) < 1e-9);
  assert.ok(Math.abs(blended.pitch - (4 * 1 + 0 * 0.5) / 1.5) < 1e-9);
  assert.equal(blendLook([{ ...candidates[0], active: false }]), null);
  assert.deepEqual(shapeGaze(20, 10, { yaw: 8, pitch: 5 }, 'look'), { yaw: 8, pitch: 5 });
  assert.deepEqual(shapeGaze(20, 10, undefined, 'avoid'), { yaw: -20, pitch: -10 });
});

// ---- Step 10 regressions -------------------------------------------------------

test('a throwing action:end listener cannot strand the promise or the queue', async () => {
  const core = make();
  const original = console.error;
  console.error = () => {};
  try {
    core.on('action:end', () => {
      throw new Error('listener boom');
    });
    const first = core.play('wink');
    const second = core.play('notify');
    core.tick(0);
    core.tick(1.6);
    assert.deepEqual(await first, { status: 'completed' });
    assert.equal(core.state.action, 'notify');
    core.tick(3.81);
    assert.deepEqual(await second, { status: 'completed' });
    assert.equal(core.state.action, null);
  } finally {
    console.error = original;
  }
});

test('send set keeps a partial clay patch partial (so createBlub merges it like set())', async () => {
  const { validateCommand } = await import('../dist/sdk/commands.js');
  assert.deepEqual(validateCommand({ type: 'set', clay: { highlight: 0.5 } }).clay, { highlight: 0.5 });
  assert.equal(validateCommand({ type: 'set', clay: 0.6 }).clay, 0.6);
  assert.throws(() => validateCommand({ type: 'set', clay: { highlight: 'lots' } }), TypeError);
});

test('one throwing frame subscriber does not freeze the shared loop', async () => {
  const queue = [];
  globalThis.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  globalThis.cancelAnimationFrame = () => {};
  const original = console.error;
  console.error = () => {};
  try {
    const { subscribeFrame, schedulerSubscribers } = await import('../dist/internal/scheduler.js');
    let good = 0;
    const offBad = subscribeFrame(() => { throw new Error('frame boom'); });
    const offGood = subscribeFrame(() => { good++; });
    for (let i = 0; i < 3; i++) {
      const cb = queue.shift();
      assert.ok(cb, `frame ${i} was scheduled`);
      cb(i * 16);
    }
    assert.equal(good, 3);
    // Subscribing from inside a frame must not start a second rAF chain.
    let inner = 0;
    let offInner = () => {};
    const offSpawner = subscribeFrame(() => {
      if (!inner++) offInner = subscribeFrame(() => {});
    });
    queue.shift()(64);
    assert.equal(queue.length, 1, 'exactly one pending frame');
    offBad(); offGood(); offSpawner(); offInner();
    assert.equal(schedulerSubscribers(), 0);
  } finally {
    console.error = original;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

function momentHost() {
  const applied = [];
  const cues = [];
  const restores = [];
  const events = [];
  const cancels = [];
  let resolvePlay = null;
  const host = {
    now: () => 0,
    apply(beat) {
      applied.push(beat);
      if (beat.play) {
        return {
          promise: new Promise((resolve) => {
            resolvePlay = resolve;
          }),
          cancel: () => cancels.push(beat.play),
        };
      }
      return null;
    },
    applyCue(cue) { cues.push(cue); },
    capture() { return { id: 'snap' }; },
    restore(snapshot, all) { restores.push([snapshot, all]); },
    emitStart(name) { events.push(['start', name]); },
    emitBeat(name, index) { events.push(['beat', name, index]); },
    emitEnd(name, status) { events.push(['end', name, status]); },
  };
  return {
    host, applied, cues, restores, events, cancels,
    finishPlay: (status = 'completed') => resolvePlay({ status }),
  };
}

test('the chain builder compiles to beats and has no then key', async () => {
  const { createMomentBuilder } = await import('../dist/sdk/moments.js');
  let seen = null;
  let options = null;
  const builder = createMomentBuilder(async (beats, runOptions) => {
    seen = beats;
    options = runOptions;
    return { status: 'completed' };
  });
  assert.equal('then' in builder, false);
  const result = await builder
    .do({ face: 'surprised', look: '#bell', play: 'notify' })
    .wait(0.4)
    .face('happy')
    .follow('pointer')
    .set({ color: 'pink' })
    .run({ restore: false });
  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(options, { restore: false });
  assert.deepEqual(seen, [
    { face: 'surprised', look: '#bell', play: 'notify' },
    { wait: 0.4 },
    { face: 'happy' },
    { follow: 'pointer' },
    { color: 'pink' },
  ]);
});

test('moment beats wait, play and fire cues at their offsets', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  const runner = createMomentRunner(fake.host);
  const done = runner.run([
    { face: 'happy' },
    { wait: 0.4 },
    { play: 'wink', cue: { face: 'sad', at: 0.2 } },
  ], 'timing', { restore: false });
  runner.update(0);
  assert.deepEqual(fake.applied.map((m) => Object.keys(m)), [['face'], ['wait']]);
  runner.update(0.39);
  assert.equal(fake.cues.length, 0);
  runner.update(0.4);
  assert.deepEqual(fake.applied.map((m) => Object.keys(m)), [['face'], ['wait'], ['play', 'cue']]);
  runner.update(0.6);
  assert.deepEqual(fake.cues, [{ face: 'sad', at: 0.2 }]);
  fake.finishPlay('completed');
  await Promise.resolve();
  runner.update(0.7);
  assert.deepEqual(await done, { status: 'completed' });
  assert.deepEqual(fake.events, [
    ['start', 'timing'],
    ['beat', 'timing', 0],
    ['beat', 'timing', 1],
    ['beat', 'timing', 2],
    ['end', 'timing', 'completed'],
  ]);
});

test('new runs interrupt; queued runs wait; stop and destroy settle cancelled', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  const runner = createMomentRunner(fake.host);

  const first = runner.run([{ wait: 1 }], 'first', { restore: false });
  runner.update(0);
  const second = runner.run([{ face: 'happy' }], 'second', { restore: false });
  assert.deepEqual(await first, { status: 'interrupted' });
  runner.update(0.1);
  assert.deepEqual(await second, { status: 'completed' });

  const third = runner.run([{ wait: 1 }], 'third', { restore: true });
  runner.update(1);
  const queued = runner.run([{ face: 'sad' }], 'queued', { restore: false, queue: true });
  runner.update(2);
  assert.deepEqual(await third, { status: 'completed' });
  runner.update(2.1);
  assert.deepEqual(await queued, { status: 'completed' });
  assert.deepEqual(fake.restores, [[{ id: 'snap' }, false]]);

  const stopped = runner.run([{ wait: 1 }], 'stopped', { restore: true });
  runner.update(3);
  runner.stop();
  assert.deepEqual(await stopped, { status: 'cancelled' });

  const destroyed = runner.run([{ wait: 1 }], 'destroyed', { restore: true });
  runner.update(4);
  runner.destroy();
  assert.deepEqual(await destroyed, { status: 'cancelled' });
});

test('a throwing moment listener does not strand the run', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  fake.host.emitBeat = () => { throw new Error('listener'); };
  const errors = [];
  const previous = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const runner = createMomentRunner(fake.host);
    const done = runner.run([{ face: 'happy' }], 'throwing', { restore: false });
    runner.update(0);
    assert.deepEqual(await done, { status: 'completed' });
    assert.ok(errors.length >= 1);
  } finally {
    console.error = previous;
  }
});

test('beat validation names the bad key and cue rules', async () => {
  const { validateBeat, validateMomentCommand } = await import('../dist/sdk/moments.js');
  assert.throws(() => validateBeat({ facez: 'happy' }), /Unknown beat key "facez"/);
  assert.throws(() => validateBeat({ hold: -1 }), /non-negative/);
  assert.throws(() => validateBeat({ cue: { face: 'happy' } }), /needs an "at"/);
  assert.throws(() => validateBeat({ cue: { play: 'wink', at: 1 } }), /cannot contain "play"/);
  const command = validateMomentCommand({
    type: 'define',
    name: 'demo',
    beats: [{ face: 'happy' }, { wait: 0.2 }],
  });
  assert.equal(command.type, 'define');
  assert.deepEqual(command.beats, [{ face: 'happy' }, { wait: 0.2 }]);
});

test('global and per-blub moment definitions override and unknown names suggest', async () => {
  const { defineMoment, registerLocal, lookupMoment, unknownMoment } = await import('../dist/sdk/moments.js');
  defineMoment('test-moment-override', (params) => [{ face: params.face }]);
  const globalEntry = lookupMoment('test-moment-override');
  assert.equal(typeof globalEntry.def, 'function');
  const local = new Map();
  registerLocal(local, 'test-moment-override', [{ face: 'sad' }]);
  assert.deepEqual(lookupMoment('test-moment-override', local).def, [{ face: 'sad' }]);
  assert.deepEqual(lookupMoment('test-moment-override').def({ face: 'happy' }), [{ face: 'happy' }]);
  assert.match(unknownMoment('sucess').message, /Did you mean "success"\?/);
});

test('moment definition restore defaults and define commands', async () => {
  const {
    defineMoment, lookupMoment, registerLocal, validateMomentCommand,
  } = await import('../dist/sdk/moments.js');
  defineMoment('keep-default-test', [], { restore: false });
  assert.equal(lookupMoment('keep-default-test').defaultRestore, false);
  const local = new Map();
  registerLocal(local, 'local-keep', [], { restore: 'all' });
  assert.equal(lookupMoment('local-keep', local).defaultRestore, 'all');
  const command = validateMomentCommand({
    type: 'define',
    name: 'json-keep',
    beats: [{ face: 'happy' }],
    restore: false,
  });
  assert.equal(command.restore, false);
  assert.equal(validateMomentCommand({ type: 'run', moment: 'success' }).moment, 'success');
});

test('moment re-entrancy: stop inside moment:beat does not apply it', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  let runner;
  fake.host.emitBeat = () => runner.stop();
  runner = createMomentRunner(fake.host);
  const done = runner.run([{ face: 'excited', play: 'celebrate' }], 'stop-inside', { restore: false });
  runner.update(0);
  assert.deepEqual(await done, { status: 'cancelled' });
  assert.equal(fake.applied.length, 0);
});

test('moment re-entrancy: run inside moment:start does not strand either run', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  let runner;
  let second = null;
  fake.host.emitStart = (name) => {
    if (name === 'old') second = runner.run([{ face: 'happy' }], 'new', { restore: false });
  };
  runner = createMomentRunner(fake.host);
  const first = runner.run([{ face: 'excited' }], 'old', { restore: false });
  runner.update(0);
  assert.deepEqual(await first, { status: 'interrupted' });
  runner.update(0.1);
  assert.deepEqual(await second, { status: 'completed' });
});

test('moment:end listeners cannot strand queued or new runs', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  let runner;
  let replacement = null;
  fake.host.emitEnd = (name) => {
    if (name === 'first') {
      replacement = runner.run([{ face: 'happy' }], 'replacement', { restore: false });
    }
  };
  runner = createMomentRunner(fake.host);
  const first = runner.run([{ wait: 0.1 }], 'first', { restore: false });
  runner.update(0);
  const queued = runner.run([{ wait: 0.1 }], 'queued', { restore: false, queue: true });
  runner.update(0.1);
  assert.deepEqual(await first, { status: 'completed' });
  assert.deepEqual(await queued, { status: 'cancelled' });
  runner.update(0.2);
  assert.deepEqual(await replacement, { status: 'completed' });
});

test('queue:true during moment:end keeps its place in line', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  let runner;
  let late = null;
  fake.host.emitEnd = (name) => {
    if (name === 'first') late = runner.run([{ face: 'sad' }], 'late', { restore: false, queue: true });
  };
  runner = createMomentRunner(fake.host);
  const first = runner.run([{ wait: 0.1 }], 'first', { restore: false });
  runner.update(0);
  const queued = runner.run([{ wait: 0.1 }], 'queued', { restore: false, queue: true });
  runner.update(0.1);
  assert.deepEqual(await first, { status: 'completed' });
  runner.update(0.2);
  runner.update(0.3);
  assert.deepEqual(await queued, { status: 'completed' });
  runner.update(0.4);
  assert.deepEqual(await late, { status: 'completed' });
});

test('begin detaches a queued run signal before attaching its own', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  const runner = createMomentRunner(fake.host);
  let removals = 0;
  const signal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { removals++; },
  };
  const first = runner.run([{ wait: 0.1 }], 'first', { restore: false });
  runner.update(0);
  const queued = runner.run([{ wait: 0.1 }], 'queued', { restore: false, queue: true, signal });
  runner.update(0.1);
  assert.ok(removals >= 1);
  runner.update(0.2);
  runner.update(0.3);
  await Promise.all([first, queued]);
});

test('Node-safe validation guards Element and follow shapes', async () => {
  const { validateBeat } = await import('../dist/sdk/moments.js');
  assert.doesNotThrow(() => validateBeat({ look: { x: 1, y: 2 } }));
  assert.throws(() => validateBeat({ follow: { foo: 1 } }), /beat\.follow/);
  assert.doesNotThrow(() => validateBeat({ follow: { target: '#bell', weight: 0.5 } }));
});

test('cues reject hold/wait; unknown names suggest local moments', async () => {
  const { validateBeat, registerLocal, unknownMoment } = await import('../dist/sdk/moments.js');
  assert.throws(() => validateBeat({ cue: { hold: 0.1, at: 0 } }), /cannot contain "hold"/);
  assert.throws(() => validateBeat({ cue: { wait: 0.1, at: 0 } }), /cannot contain "wait"/);
  const local = new Map();
  registerLocal(local, 'localMoment', []);
  assert.match(unknownMoment('localMomentTypo', local).message, /Did you mean "localMoment"\?/);
});

test('cancelAction ends only the named running action', async () => {
  const core = make();
  const wink = core.play('wink');
  core.tick(0);
  assert.equal(core.cancelAction('notify'), false);
  assert.equal(core.state.action, 'wink');
  assert.equal(core.cancelAction('wink'), true);
  assert.deepEqual(await wink, { status: 'cancelled' });
  assert.equal(core.state.action, null);
  assert.equal(core.state.status, 'idle');
});

test('run inside moment:beat also abandons the dead beat', async () => {
  const { createMomentRunner } = await import('../dist/internal/moment-runner.js');
  const fake = momentHost();
  let runner;
  let replacement = null;
  fake.host.emitBeat = (name) => {
    if (name === 'old') replacement = runner.run([{ face: 'happy' }], 'new', { restore: false });
  };
  runner = createMomentRunner(fake.host);
  const first = runner.run([{ face: 'excited', play: 'celebrate' }], 'old', { restore: false });
  runner.update(0);
  assert.deepEqual(await first, { status: 'interrupted' });
  assert.equal(fake.applied.length, 0);
  runner.update(0.1);
  assert.deepEqual(await replacement, { status: 'completed' });
});

test('accessories: validated, one per slot, and a bare blub is unchanged', async () => {
  const { renderBlubSVG } = await import('../dist/engine-entry.js');
  const bare = renderBlubSVG({ shape: 'pebble', time: 1 });
  assert.equal(renderBlubSVG({ shape: 'pebble', time: 1, accessories: [] }), bare);
  assert.notEqual(renderBlubSVG({ shape: 'pebble', time: 1, accessories: ['hat'] }), bare);
  assert.throws(() => renderBlubSVG({ accessories: ['crown'] }), /Unknown accessory "crown"/);
  const { normalizeAccessories } = await import('../dist/sdk/accessories.js');
  assert.deepEqual(normalizeAccessories(['tie', { id: 'bowtie', color: 'red' }]).map((w) => w.id), ['bowtie']);
});

test('accessories: frames are a pure function of time, on every shape and state', async () => {
  const { BlubEngine, SHAPES, STATES } = await import('../dist/engine/index.js');
  const wear = [{ id: 'hat', color: null }, { id: 'tie', color: null }, { id: 'mustache', color: null }];
  for (const shape of SHAPES) {
    for (const state of STATES) {
      const make = () => {
        const engine = new BlubEngine(100, 'idle', shape.radii);
        engine.setAccessories(wear, 0, true);
        engine.setState(state.id, 1);
        return engine;
      };
      const out = make().sample(1.7).accessories;
      assert.deepEqual(out, make().sample(1.7).accessories);
      for (const item of out) {
        for (const part of item.parts) assert.ok(!/NaN|Infinity/.test(part.d), `${shape.id}/${state.id}/${item.id}`);
      }
    }
  }
});

test('accessories: arrive, settle and leave', async () => {
  const { BlubEngine } = await import('../dist/engine/index.js');
  const engine = new BlubEngine(100, 'idle');
  engine.setAccessories([{ id: 'hat', color: null }], 1);
  assert.notEqual(JSON.stringify(engine.sample(1.1).accessories), JSON.stringify(engine.sample(1.9).accessories));
  engine.setAccessories([], 2);
  assert.equal(engine.sample(2.1).accessories.length, 1);
  assert.equal(engine.sample(2.5).accessories.length, 0);
});

test('accessories: shadows are one real blur, with room for the falloff', async () => {
  const { BlubEngine, SHAPES, renderBlubSVG } = await import('../dist/engine-entry.js');
  const engine = new BlubEngine(100, 'idle', SHAPES[0].radii);
  engine.setAccessories([{ id: 'hat', color: null }, { id: 'tie', color: null }], 0, true);
  for (const item of engine.sample(3).accessories) {
    const blurred = item.parts.filter((part) => part.blur);
    assert.ok(blurred.length > 0, `${item.id} has a soft shadow`);
    for (const { d, blur, opacity } of blurred) {
      assert.ok(opacity <= 0.2 + 1e-9, 'stays gentle');
      const numbers = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const margin = blur.deviation * 2.9;
      numbers.forEach((n, i) => {
        const [lo, size] = i % 2 ? [blur.y, blur.height] : [blur.x, blur.width];
        assert.ok(n - margin >= lo && n + margin <= lo + size, 'filter area clears the blur');
      });
    }
  }
  const svg = renderBlubSVG({ shape: 'circle', time: 3, accessories: ['hat'] });
  assert.match(svg, /<feGaussianBlur stdDeviation="[\d.]+"\/>/);
  assert.doesNotMatch(renderBlubSVG({ shape: 'circle', time: 3 }), /<filter/);
});

test('accessories: a worn piece never touches the eyes, and a tie hangs long and narrow', async () => {
  const { BlubEngine, SHAPES, EXPRESSIONS } = await import('../dist/engine-entry.js');
  const { eyesBottom } = await import('../dist/engine/accessories.js');
  const top = (d) => Math.min(...d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2));
  for (const shape of SHAPES) {
    for (const expression of EXPRESSIONS) {
      for (const id of ['tie', 'bowtie', 'mustache']) {
        const engine = new BlubEngine(100, 'idle', shape.radii, expression);
        engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
        engine.setAccessories([{ id, color: null }], 0, true);
        const sample = engine.sample(3);
        const eyes = eyesBottom(sample.eyes);
        if (eyes === null) continue;
        const painted = sample.accessories[0].parts.filter((part) => !part.blur);
        if (id === 'mustache') {
          // On a tilted face a raised tip sits under the raised eye, so compare each eye
          // only with the points directly beneath it.
          const points = painted.flatMap((part) => {
            const n = part.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
            return n.flatMap((x, i) => (i % 2 ? [] : [[x, n[i + 1]]]));
          });
          for (const eye of sample.eyes) {
            const m = eye.matrix.match(/-?\d+(?:\.\d+)?/g).map(Number);
            const half = Math.max(...eye.d.split(/[MLAZ]/).filter(Boolean).map((seg) => {
              const v = seg.trim().split(/\s+/).map(Number);
              return Math.abs(v[v.length - 2]);
            })) * Math.hypot(m[0], m[1]);
            const under = points.filter(([x]) => Math.abs(x - m[4]) < half);
            const bottom = eyesBottom([eye]);
            for (const [x, y] of under) {
              assert.ok(y > bottom, `mustache on ${shape.id}/${expression.id}: (${x}, ${y}) under eye at ${bottom}`);
            }
          }
          continue;
        }
        const high = Math.min(...painted.map((part) => top(part.d)));
        assert.ok(high > eyes, `${id} on ${shape.id}/${expression.id}: ${high} is below ${eyes}`);
      }
    }
  }
  const engine = new BlubEngine(100, 'idle', SHAPES[0].radii);
  engine.setAccessories([{ id: 'tie', color: null }], 0, true);
  const blade = engine.sample(3).accessories[0].parts.find((part) => !part.blur);
  const numbers = blade.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const span = (odd) => {
    const values = numbers.filter((_, i) => i % 2 === odd);
    return Math.max(...values) - Math.min(...values);
  };
  assert.ok(span(1) > span(0) * 2.2, `blade ${span(0)} wide and ${span(1)} long`);
  // It hangs off the body rather than ending on it, and the tip stays in a square export.
  const lowest = Math.max(...numbers.filter((_, i) => i % 2));
  assert.ok(lowest > 100 && lowest <= 124, `tip at ${lowest}`);
  assert.equal(blade.masked, false);
});

test('renderBlubSVG: different blubs on one page never share ids', async () => {
  const { renderBlubSVG } = await import('../dist/engine-entry.js');
  const ids = (svg) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const a = renderBlubSVG({ shape: 'pebble', color: 'blue', accessories: ['hat'] });
  const b = renderBlubSVG({ shape: 'capsule', color: 'blue', accessories: ['hat'] });
  assert.equal(ids(a).filter((id) => ids(b).includes(id)).length, 0);
  assert.equal(renderBlubSVG({ shape: 'pebble', color: 'blue', accessories: ['hat'] }), a, 'same input, same bytes');
  assert.ok(ids(renderBlubSVG({ uid: 'mine' })).every((id) => id.startsWith('mine-')), 'an explicit uid still wins');
});

test('accessories: a mustache shares the face with a hat and tie, and keeps above a bow', async () => {
  const { BlubEngine, SHAPES } = await import('../dist/engine-entry.js');
  const { normalizeAccessories } = await import('../dist/sdk/accessories.js');
  assert.deepEqual(normalizeAccessories(['hat', 'tie', 'mustache']).map((w) => w.id), ['hat', 'tie', 'mustache']);
  const ys = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2);
  for (const shape of SHAPES) {
    const engine = new BlubEngine(100, 'idle', shape.radii);
    engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
    engine.setAccessories([{ id: 'mustache', color: null }, { id: 'bowtie', color: null }], 0, true);
    const items = engine.sample(3).accessories;
    const paint = (id) => items.find((item) => item.id === id).parts.filter((part) => !part.blur);
    const lip = Math.max(...paint('mustache').flatMap((part) => ys(part.d)));
    const bow = Math.min(...paint('bowtie').flatMap((part) => ys(part.d)));
    assert.ok(bow > lip - 1, `${shape.id}: bow top ${bow}, mustache bottom ${lip}`);
  }
  const engine = new BlubEngine(100, 'idle', SHAPES[0].radii);
  engine.setAccessories([{ id: 'mustache', color: null }], 0, true);
  const worn = engine.sample(3).accessories[0].parts.length;
  assert.ok(worn > 0);
  engine.setAccessories([], 4);
  assert.equal(engine.sample(4.5).accessories.length, 0);
});

test('accessories: a mustache is black by default, and a shared colour never reaches it', async () => {
  const { BlubEngine, SHAPES, accessoryPartColor } = await import('../dist/engine-entry.js');
  const engine = new BlubEngine(100, 'idle', SHAPES[0].radii);
  engine.setAccessories([{ id: 'mustache', color: null }], 0, true);
  const hair = engine.sample(3).accessories[0].parts.find((part) => !part.blur);
  assert.equal(accessoryPartColor(hair, '#3b93f0'), '#000000');
  assert.equal(hair.clay, false, 'black stays pure');
  assert.notEqual(accessoryPartColor(hair, '#0a0a0c'), '#000000', 'visible on a very dark body');

  const { parseConfig, configQuery, wearColors } = await import('../catalog.mjs');
  const separate = parseConfig('?wear=hat,tie,mustache&tones=hat:c8324a,tie:1f6b4a');
  assert.deepEqual(wearColors(separate), [
    { id: 'hat', color: '#c8324a' }, { id: 'tie', color: '#1f6b4a' }, { id: 'mustache', color: null },
  ]);
  const shared = parseConfig('?wear=hat,tie,mustache&tone=e0a526&tones=mustache:6b4226');
  assert.deepEqual(wearColors(shared).map((w) => w.color), ['#e0a526', '#e0a526', '#6b4226']);
  assert.deepEqual(parseConfig(configQuery({ ...shared })).tones, { lip: '#6b4226' });
  const old = parseConfig('?wear=hat,mustache&tone=c8324a');
  assert.deepEqual(wearColors(old).map((w) => w.color), ['#c8324a', null], 'an old link keeps working');
});
