#!/usr/bin/env node
// DOM fidelity check: the live DOM view must rasterise pixel-identically to renderSVG().
// Runs the same blub through both paths, screenshots each in Chrome, and diffs the pixels.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_DIFF = 2; // antialiasing only
const SIZE = 320;

async function launchBrowser() {
  const args = ['--disable-gpu', '--js-flags=--expose-gc'];
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) return chromium.launch({ executablePath: chromePath, args });
  try {
    return await chromium.launch({ args });
  } catch {}
  try {
    return await chromium.launch({ channel: 'chrome', args });
  } catch {}
  console.error(
    'No browser could be launched. Install one with `npx playwright-core install chromium`, or set CHROME_PATH to a Chrome binary.',
  );
  process.exit(1);
}

const HARNESS = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head>
<body>
<script type="module">
import { createBlub } from '/dist/index.js';
import { createBlubModel } from '/dist/internal/model.js';
import { createBlubView } from '/dist/internal/view.js';
import { schedulerSubscribers } from '/dist/internal/scheduler.js';
import { followInputSubscribers } from '/dist/internal/follow-inputs.js';
import { trackedElementCount } from '/dist/internal/element-metrics.js';
import { renderSVG } from '/dist/render/svg.js';

const W = ${SIZE};
const CASES = [
  { shape: 'circle', face: 'neutral', color: 'blue', action: 'idle', t: 0.35 },
  { shape: 'pebble', face: 'happy', color: 'blue', action: 'idle', t: 1.64968 },
  { shape: 'cloud', face: 'curious', color: 'purple', action: 'thinking', t: 1.2 },
  { shape: 'triangle', face: 'surprised', color: 'orange', action: 'alert', t: 2.0 },
  { shape: 'hexagon', face: 'sleepy', color: 'green', action: 'swirl', t: 0.8 },
  { shape: 'capsule', face: 'excited', color: 'pink', action: 'burst', t: 1.5, finish: 'flat' },
  { shape: 'droplet', face: 'shy', color: 'turquoise', action: 'comet', t: 2.5 },
  { shape: 'squircle', face: 'angry', color: 'red', action: 'wink', t: 0.5 },
  { shape: 'circle', face: 'neutral', color: '#7a4bd6', action: 'orbit', t: 1.0, finish: 'flat' },
  { shape: 'cloud', face: 'proud', color: 'amber', action: 'notify', t: 1.1 },
  { shape: 'pebble', face: 'sad', color: 'grey', action: 'sleep', t: 2.0 },
  { shape: 'triangle', face: 'laughing', color: 'brown', action: 'play', t: 0.9 },
  { shape: 'circle', face: 'happy', color: 'blue', action: 'idle', t: 1.2, wear: ['hat', 'tie'] },
  { shape: 'droplet', face: 'surprised', color: 'red', action: 'notify', t: 0.4, wear: ['hat', 'bowtie'] },
  { shape: 'hexagon', face: 'proud', color: 'green', action: 'idle', t: 2, finish: 'flat', wear: ['bowtie'] },
  { shape: 'pebble', face: 'surprised', color: 'orange', action: 'idle', t: 1.6, wear: ['hat', 'mustache', 'tie'] },
];

window.__cases = CASES.length;

function host(id, x) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'box';
  el.style.cssText = 'position:absolute;top:0;width:' + W + 'px;height:' + W + 'px;left:' + x + 'px';
  return el;
}

window.__pair = function (index) {
  const c = CASES[index];
  const cfg = { shape: c.shape, face: c.face, color: c.color, finish: c.finish || 'clay', action: c.action };

  const a = host('a', 0);
  const blubA = createBlubModel(cfg);
  if (c.wear) blubA.setAccessories(c.wear.map(function (id) { return { id: id, color: null }; }), 0, true);
  a.innerHTML = renderSVG(blubA.sample(c.t), {
    color: blubA.color,
    size: W,
    crop: 124,
    scale: 158,
    paper: blubA.paper,
    eye: blubA.eye,
    clay: blubA.finish === 'clay',
    uid: 'string-' + index,
    background: null,
  });

  const b = host('b', 340);
  const blubB = createBlubModel(cfg);
  if (c.wear) blubB.setAccessories(c.wear.map(function (id) { return { id: id, color: null }; }), 0, true);
  const view = createBlubView(b, blubB, { crop: 124, scale: 158, background: null, uid: 'dom-' + index });
  view.render(c.t);
  b.__view = view;

  // Match the string SVG's sizing exactly: both are explicit 320 px blocks.
  const sa = a.firstElementChild;
  sa.setAttribute('width', W);
  sa.setAttribute('height', W);
  sa.style.display = 'block';
  view.el.setAttribute('width', W);
  view.el.setAttribute('height', W);
  view.el.style.display = 'block';

  document.body.appendChild(a);
  document.body.appendChild(b);
  const rect = (el) => ({ x: el.offsetLeft, y: el.offsetTop, width: W, height: W });
  return { a: rect(a), b: rect(b) };
};

// Screenshots are taken one at a time with the element parked at 0,0; clipping the
// second element at x=340 introduces a subpixel compositing shift in Chrome.
window.__parkB = function () {
  document.getElementById('a').style.display = 'none';
  document.getElementById('b').style.left = '0px';
};

window.__clear = function () {
  document.querySelectorAll('.box').forEach(function (n) {
    if (n.__view) n.__view.destroy();
    n.remove();
  });
};

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

window.__diff = async function (aB64, bB64) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const images = await Promise.all([
    loadImage('data:image/png;base64,' + aB64),
    loadImage('data:image/png;base64,' + bB64),
  ]);
  ctx.clearRect(0, 0, W, W);
  ctx.drawImage(images[0], 0, 0);
  const A = ctx.getImageData(0, 0, W, W).data;
  ctx.clearRect(0, 0, W, W);
  ctx.drawImage(images[1], 0, 0);
  const B = ctx.getImageData(0, 0, W, W).data;
  let max = 0;
  let pixels = 0;
  for (let i = 0; i < A.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(A[i + k] - B[i + k]));
    if (d > max) max = d;
    if (d > 0) pixels++;
  }
  return { max: max, pixels: pixels };
};

window.__countTest = function () {
  const shapes = ['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'];
  const faces = ['neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy', 'unimpressed', 'sleepy'];
  const actions = ['idle', 'thinking', 'wink', 'wide', 'alert', 'notify', 'exclaim', 'sleep', 'egg', 'hexagon', 'play', 'orbit', 'swirl', 'burst', 'comet'];
  const colors = ['blue', 'red', 'green', '#ff8800'];

  const el = host('count', 0);
  document.body.appendChild(el);
  const blub = createBlubModel({ shape: 'circle', face: 'neutral', color: 'blue', action: 'idle' });
  const view = createBlubView(el, blub);
  const svg = view.el;
  const base = svg.querySelectorAll('*').length;
  const counts = {};

  for (let i = 0; i < 600; i++) {
    const t = i * 0.017;
    if (i % 37 === 0) blub.play(actions[Math.floor(i / 37) % actions.length], t, { restart: true });
    if (i % 53 === 0) {
      const k = Math.floor(i / 53);
      blub.setShape(shapes[k % shapes.length], t);
      blub.setFace(faces[k % faces.length], t);
      blub.setColor(colors[k % colors.length]);
      blub.setFinish(k % 2 ? 'flat' : 'clay');
    }
    view.render(t);
    const n = svg.querySelectorAll('*').length;
    counts[n] = (counts[n] || 0) + 1;
  }

  view.destroy();
  el.remove();
  return { base: base, counts: counts, stable: Object.keys(counts).length === 1 };
};

function eyeX(svg) {
  const path = [...svg.querySelectorAll('mask path')].find((node) => node.getAttribute('transform'));
  const matrix = path.getAttribute('transform').match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
  return matrix[4];
}

window.__sdkTest = async function () {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:240px;height:240px';
  document.body.appendChild(host);
  const blub = createBlub(host, {
    shape: 'circle', face: 'neutral', color: 'blue', size: 240, clock: 'manual',
  });
  blub.render(0);
  const svg = blub.el;
  const role = svg.getAttribute('role');
  const label = svg.getAttribute('aria-label');

  const stops = () => [...svg.querySelectorAll('radialGradient stop')].map((stop) => stop.getAttribute('stop-color'));
  const startStop = stops()[0];
  blub.set({ color: 'pink' });
  blub.render(0.2);
  const midStop = stops()[0];
  blub.render(0.5);
  const endStop = stops()[0];
  const targetColor = blub.state.color;
  const clayStart = stops()[0];
  blub.set({ clay: 0.5 });
  blub.render(0.7);
  const clayMid = stops()[0];
  blub.set({ color: 'blue', clay: 1 }, { duration: 0 });
  blub.render(0.8);

  let enters = 0;
  let leaves = 0;
  const offEnter = blub.on('follow:enter', () => enters++);
  const offLeave = blub.on('follow:leave', () => leaves++);
  blub.follow('pointer', { radius: 80, exitRadius: 100, onLeave: 'wander' });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 120 }));
  blub.render(0.82);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 240 }));
  blub.render(0.84);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 230 }));
  blub.render(0.86);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 120 }));
  blub.render(0.88);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 120 }));
  blub.render(0.9);
  blub.follow(null);
  offEnter();
  offLeave();

  // Regression: replacing an active follow must stop() the old one (fires follow:leave).
  let replacedLeaves = 0;
  const offReplaced = blub.on('follow:leave', () => replacedLeaves++);
  blub.follow('pointer', { radius: 80, exitRadius: 100 });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 120 }));
  blub.render(0.91);
  blub.follow('#no-such-element');
  blub.render(0.92);
  blub.follow(null);
  offReplaced();

  blub.follow('pointer');
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 120 }));
  blub.render(0.9);
  blub.render(1.0);
  const left = eyeX(svg);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 120 }));
  blub.render(1.1);
  blub.render(1.4);
  const right = eyeX(svg);
  blub.follow(null);

  const promise = blub.play('wink');
  blub.render(1.5);
  blub.tick(1.7);
  const result = await promise;
  const actionAfter = blub.state.action;

  blub.status('thinking');
  const statusAfter = blub.state.status;
  const frozen = Object.isFrozen(blub.state);

  blub.destroy();
  const removed = host.querySelector('svg') === null;
  blub.destroy();
  host.remove();
  return {
    left, right, role, label, result, actionAfter, statusAfter, frozen, removed,
    startStop, midStop, endStop, targetColor, clayStart, clayMid, enters, leaves, replacedLeaves,
  };
};


window.__targetsTest = function () {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:200px';
  document.body.appendChild(host);
  const blub = createBlub(host, {
    shape: 'circle', face: 'neutral', color: 'blue', size: 200, clock: 'manual',
  });
  const a = document.createElement('input');
  a.id = 'field-a';
  a.style.cssText = 'position:absolute;left:20px;top:300px;width:180px';
  a.value = 'hello world';
  const b = document.createElement('input');
  b.id = 'field-b';
  b.style.cssText = 'position:absolute;left:500px;top:300px;width:180px';
  document.body.appendChild(a);
  document.body.appendChild(b);
  const svg = blub.el;

  blub.follow('focus');
  a.focus();
  blub.render(0);
  blub.render(0.3);
  const focusLeft = eyeX(svg);
  b.focus();
  blub.render(0.4);
  blub.render(0.8);
  const focusRight = eyeX(svg);

  blub.follow('caret');
  a.focus();
  a.setSelectionRange(0, 0);
  document.dispatchEvent(new Event('selectionchange'));
  blub.render(1.0);
  blub.render(1.4);
  const caretLeft = eyeX(svg);
  a.setSelectionRange(a.value.length, a.value.length);
  document.dispatchEvent(new Event('selectionchange'));
  blub.render(1.5);
  blub.render(1.9);
  const caretRight = eyeX(svg);

  let firstCtx = null;
  let stable = true;
  let calls = 0;
  blub.follow((ctx) => {
    calls++;
    if (!firstCtx) firstCtx = ctx;
    else if (ctx !== firstCtx || ctx.pointer !== firstCtx.pointer || ctx.blub.rect !== firstCtx.blub.rect || ctx.focus !== firstCtx.focus) {
      stable = false;
    }
    return [{ target: 'pointer', weight: 1 }];
  });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));
  blub.render(2.0);
  blub.render(2.1);
  blub.render(2.2);

  const targetEvents = [];
  blub.on('follow:target', (event) => targetEvents.push(event));
  blub.follow('focus');
  a.focus();
  blub.render(2.3);
  blub.render(2.4);
  b.focus();
  blub.render(2.5);
  blub.render(2.7);
  const switches = targetEvents.length;
  const payloads = targetEvents.map((event) => [event.from, event.to]);

  blub.destroy();
  a.remove();
  b.remove();
  host.remove();
  return { focusLeft, focusRight, caretLeft, caretRight, stable, calls, switches, payloads, removed: host.querySelector('svg') === null };
};


window.__momentTest = async function () {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:200px';
  document.body.appendChild(host);
  const target = document.createElement('div');
  target.style.cssText = 'position:absolute;left:500px;top:300px;width:60px;height:40px;background:#000';
  document.body.appendChild(target);
  const blub = createBlub(host, {
    shape: 'circle', face: 'neutral', color: 'blue', size: 200, clock: 'manual',
  });
  blub.lookAt({ yaw: -10, pitch: 2 });
  blub.render(0);
  blub.render(0.4);
  const before = eyeX(blub.el);

  const events = [];
  blub.on('moment:start', (event) => events.push(['start', event.name]));
  blub.on('moment:beat', (event) => events.push(['beat', event.index]));
  blub.on('moment:end', (event) => events.push(['end', event.status]));

  const done = blub.run('newNotification', { target });
  blub.render(0.5);
  blub.render(0.8);
  const during = eyeX(blub.el);
  blub.render(2.4);
  blub.render(2.5);
  blub.render(3.12);
  await Promise.resolve();
  blub.render(3.2);
  blub.render(3.9);
  const result = await done;
  blub.render(4.2);
  blub.render(4.6);
  const after = eyeX(blub.el);
  const afterState = { face: blub.state.face, status: blub.state.status, action: blub.state.action };

  // Restoring a follow that a moment suspended for a look.
  blub.follow('pointer');
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 300 }));
  blub.render(5.0);
  blub.render(5.4);
  const followLeft = eyeX(blub.el);
  blub.define('lookAway', [{ look: target, hold: 0.2 }]);
  const followRun = blub.run('lookAway');
  blub.render(5.5);
  blub.render(5.6);
  const away = eyeX(blub.el);
  blub.render(5.8);
  await followRun;
  blub.render(6.2);
  blub.render(6.6);
  const restoredFollow = eyeX(blub.el);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 300 }));
  blub.render(6.9);
  blub.render(7.3);
  const tracked = eyeX(blub.el);

  blub.destroy();
  target.remove();
  host.remove();
  return {
    before, during, after, result, events, afterState, removed: host.querySelector('svg') === null,
    followLeft, away, restoredFollow, tracked,
  };
};


window.__seqReviewTest = async function () {
  const make = () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:200px';
    document.body.appendChild(host);
    const blub = createBlub(host, {
      shape: 'circle', face: 'neutral', color: 'blue', size: 200, clock: 'manual',
    });
    return { host, blub };
  };
  const close = ({ host, blub }) => { blub.destroy(); host.remove(); };
  const out = {};

  // Item 3: a beat's play interrupts an existing action. Item 2: stop cancels it.
  {
    const a = make();
    a.blub.play('wink');
    a.blub.render(0);
    a.blub.define('together', [{ face: 'surprised', play: 'notify' }]);
    const run = a.blub.run('together');
    a.blub.render(0.1);
    out.momentAction = a.blub.state.action;
    a.blub.stop();
    out.stopAction = a.blub.state.action;
    out.stopFace = a.blub.state.face;
    out.stopResult = (await run).status;
    close(a);
  }

  // Item 1: two notifications in a row restore the original face.
  {
    const a = make();
    const first = a.blub.run('newNotification');
    a.blub.render(0.1);
    const second = a.blub.run('newNotification');
    a.blub.render(0.2);
    a.blub.render(2.5);
    await Promise.resolve();
    a.blub.render(2.6);
    a.blub.render(3.3);
    out.twoResults = [(await first).status, (await second).status];
    out.twoFace = a.blub.state.face;
    out.twoAction = a.blub.state.action;
    close(a);
  }

  // Item 4: a moment that starts a follow must stop it on restore.
  {
    const a = make();
    const pairs = [];
    a.blub.on('follow:target', (event) => pairs.push([event.from, event.to]));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 300 }));
    a.blub.render(0);
    a.blub.define('f', [{ follow: 'pointer', hold: 0.1 }]);
    const run = a.blub.run('f');
    a.blub.render(0.1);
    a.blub.render(0.3);
    out.followPairs = pairs;
    out.followResult = (await run).status;
    close(a);
  }

  // Item 5: restore:false keeps the end state; a hold makes the last beat visible.
  {
    const a = make();
    a.blub.define('keep', [{ face: 'excited' }], { restore: false });
    const keep = a.blub.run('keep');
    a.blub.render(0);
    out.keepStatus = (await keep).status;
    out.keepFace = a.blub.state.face;

    a.blub.define('seen', [{ face: 'happy', hold: 0.2 }]);
    const seen = a.blub.run('seen');
    a.blub.render(0.5);
    out.seenFace = a.blub.state.face;
    a.blub.render(0.8);
    out.seenStatus = (await seen).status;
    out.seenRestored = a.blub.state.face;
    close(a);
  }

  // Item 10: a missing look target is skipped, not fatal.
  {
    const a = make();
    const run = a.blub.run('newNotification', { target: '#does-not-exist' });
    a.blub.render(0);
    a.blub.render(2.3);
    await Promise.resolve();
    a.blub.render(2.4);
    a.blub.render(3.1);
    out.missingStatus = (await run).status;
    out.missingFace = a.blub.state.face;
    out.missingAction = a.blub.state.action;
    close(a);
  }

  // Item 5, second example: an end state kept with restore:false persists.
  {
    const a = make();
    a.blub.define('keepFollow', [{ face: 'happy', follow: 'pointer' }], { restore: false });
    const run = a.blub.run('keepFollow');
    a.blub.render(0);
    out.keepFollowStatus = (await run).status;
    out.keepFollowFace = a.blub.state.face;
    close(a);
  }

  return out;
};

window.__leakTest = function () {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(host);
  if (window.gc) window.gc();
  const before = performance.memory ? performance.memory.usedJSHeapSize : 0;

  for (let i = 0; i < 1000; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:32px;height:32px;position:absolute';
    host.appendChild(cell);
    const blub = createBlub(cell, { clock: 'manual', size: 32, shape: 'circle', face: 'neutral', color: 'blue' });
    blub.render(0);
    blub.destroy();
    cell.remove();
  }

  if (window.gc) window.gc();
  const after = performance.memory ? performance.memory.usedJSHeapSize : 0;
  const result = {
    before,
    after,
    growth: after - before,
    scheduler: schedulerSubscribers(),
    inputs: followInputSubscribers(),
    metrics: trackedElementCount(),
    svgs: host.querySelectorAll('svg').length,
  };
  host.remove();
  return result;
};

window.__perfTest = function () {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(host);
  const blubs = [];
  for (let i = 0; i < 50; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:64px;height:64px;position:absolute';
    host.appendChild(cell);
    blubs.push(createBlub(cell, {
      clock: 'manual', size: 64, fps: 30, shape: 'cloud', face: 'curious', color: 'blue',
    }));
  }
  const frames = 60;
  const start = performance.now();
  for (let f = 0; f < frames; f++) {
    for (const blub of blubs) blub.render(f / 60);
  }
  const elapsed = performance.now() - start;
  for (const blub of blubs) blub.destroy();
  const svgs = host.querySelectorAll('svg').length;
  host.remove();
  return {
    blubs: 50,
    frames,
    msPerFrame: elapsed / frames,
    usPerBlubFrame: (elapsed * 1000) / (frames * blubs.length),
    svgs,
  };
};
</script>
</body>
</html>`;

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__harness') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HARNESS);
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
server.unref();
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launchBrowser();
let failed = false;
let totalDiff = 0;
let totalPixels = 0;
let countResult = null;

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/__harness`, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__pair === "function"');
  const cases = await page.evaluate('window.__cases');

  console.log(`renderSVG (string) vs createBlubView (DOM), ${SIZE}px, ${cases} cases\n`);
  for (let i = 0; i < cases; i++) {
    const rects = await page.evaluate((index) => window.__pair(index), i);
    const a = await page.screenshot({ clip: rects.a });
    await page.evaluate('window.__parkB()');
    const b = await page.screenshot({ clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    const diff = await page.evaluate(
      ({ aB64, bB64 }) => window.__diff(aB64, bB64),
      { aB64: a.toString('base64'), bB64: b.toString('base64') }
    );
    totalDiff = Math.max(totalDiff, diff.max);
    totalPixels += diff.pixels;
    if (diff.max > MAX_DIFF) failed = true;
    console.log(`  case ${String(i + 1).padStart(2)}  max channel diff ${diff.max}/255, ${diff.pixels} px differ`);
    await page.evaluate('window.__clear()');
  }

  countResult = await page.evaluate('window.__countTest()');
  console.log(`\n600 render() calls: ${countResult.base} elements at start, counts ${JSON.stringify(countResult.counts)}`);
  console.log(`element count stable: ${countResult.stable ? 'yes' : 'NO'}`);
  if (!countResult.stable) failed = true;

  const sdk = await page.evaluate('window.__sdkTest()');
  const eyesMoved = Number.isFinite(sdk.left) && Number.isFinite(sdk.right) && sdk.right > sdk.left + 1;
  console.log(`\nSDK: role=${sdk.role} label=${JSON.stringify(sdk.label)} eye x ${sdk.left.toFixed(2)} -> ${sdk.right.toFixed(2)} (${eyesMoved ? 'moved' : 'NO'})`);
  console.log(`SDK: play result ${JSON.stringify(sdk.result)}, action after ${JSON.stringify(sdk.actionAfter)}, status ${JSON.stringify(sdk.statusAfter)}, frozen=${sdk.frozen}, removed=${sdk.removed}`);
  const colourTransitioned = sdk.midStop !== sdk.startStop && sdk.midStop !== sdk.endStop;
  console.log(`SDK: colour ${sdk.startStop} -> ${sdk.midStop} -> ${sdk.endStop} (target ${sdk.targetColor}), clay ${sdk.clayStart} -> ${sdk.clayMid}`);
  console.log(`SDK: follow enter/leave ${sdk.enters}/${sdk.leaves}, leave on replace ${sdk.replacedLeaves}`);
  if (sdk.replacedLeaves !== 1) failed = true;
  if (!eyesMoved || sdk.result.status !== 'completed' || sdk.actionAfter !== null || sdk.statusAfter !== 'thinking' || !sdk.frozen || !sdk.removed) {
    failed = true;
  }
  if (!colourTransitioned || sdk.endStop === sdk.startStop || sdk.clayMid === sdk.clayStart) failed = true;
  if (sdk.enters !== 2 || sdk.leaves !== 2) failed = true;

  const targets = await page.evaluate('window.__targetsTest()');
  const focusMoved = Number.isFinite(targets.focusLeft) && targets.focusRight > targets.focusLeft + 1;
  const caretMoved = Number.isFinite(targets.caretLeft) && targets.caretRight > targets.caretLeft + 1;
  console.log(`\nTargets: focus eye x ${targets.focusLeft.toFixed(2)} -> ${targets.focusRight.toFixed(2)} (${focusMoved ? 'moved' : 'NO'}), caret ${targets.caretLeft.toFixed(2)} -> ${targets.caretRight.toFixed(2)} (${caretMoved ? 'moved' : 'NO'})`);
  console.log(`Targets: dynamic ctx stable=${targets.stable} calls=${targets.calls}, follow:target ${JSON.stringify(targets.payloads)}, removed=${targets.removed}`);
  if (!focusMoved || !caretMoved || !targets.stable || targets.calls < 3 || targets.switches !== 3 || !targets.removed) failed = true;
  if (JSON.stringify(targets.payloads) !== JSON.stringify([['pointer', null], [null, 'focus#field-a'], ['focus#field-a', 'focus#field-b']])) failed = true;

  const seq = await page.evaluate('window.__momentTest()');
  const seqLooked = Number.isFinite(seq.during) && seq.during > seq.before + 1;
  const seqRestored = Number.isFinite(seq.after) && seq.after < seq.during - 1;
  console.log(`\nMoment: newNotification eyes ${seq.before.toFixed(2)} -> ${seq.during.toFixed(2)} -> ${seq.after.toFixed(2)} (looked=${seqLooked} restored=${seqRestored}), result=${JSON.stringify(seq.result)}`);
  console.log(`Moment: events=${JSON.stringify(seq.events)}, state=${JSON.stringify(seq.afterState)}, removed=${seq.removed}`);
  if (!seqLooked || !seqRestored || seq.result.status !== 'completed') failed = true;
  if (seq.afterState.face !== 'neutral' || seq.afterState.status !== 'idle' || seq.afterState.action !== null) failed = true;
  if (seq.events.filter((event) => event[0] === 'start').length !== 2) failed = true;
  if (seq.events.at(-1)?.[0] !== 'end' || seq.events.at(-1)?.[1] !== 'completed') failed = true;
  if (!seq.removed) failed = true;
  const followSuspended = Number.isFinite(seq.away) && seq.away > seq.followLeft + 1;
  const followRestored = Number.isFinite(seq.restoredFollow) && seq.restoredFollow < seq.away - 1;
  const followTracks = Number.isFinite(seq.tracked) && seq.tracked > seq.restoredFollow + 1;
  console.log(`Moment: follow restore ${seq.followLeft.toFixed(2)} -> away ${seq.away.toFixed(2)} -> back ${seq.restoredFollow.toFixed(2)} -> track ${seq.tracked.toFixed(2)}`);
  if (!followSuspended || !followRestored || !followTracks) failed = true;

  const review = await page.evaluate('window.__seqReviewTest()');
  console.log(`\nReview: beat play interrupts -> ${JSON.stringify(review.momentAction)}, stop -> ${JSON.stringify(review.stopAction)}/${JSON.stringify(review.stopFace)}/${review.stopResult}`);
  console.log(`Review: two notifications ${JSON.stringify(review.twoResults)} face=${review.twoFace} action=${JSON.stringify(review.twoAction)}`);
  console.log(`Review: follow restore ${JSON.stringify(review.followPairs)} (${review.followResult})`);
  console.log(`Review: keep=${review.keepFace}/${review.keepStatus}, seen=${review.seenFace} restored=${review.seenRestored}/${review.seenStatus}, keepFollow=${review.keepFollowFace}/${review.keepFollowStatus}`);
  console.log(`Review: missing look ${review.missingStatus} face=${review.missingFace} action=${JSON.stringify(review.missingAction)}`);
  if (review.momentAction !== 'notify' || review.stopAction !== null || review.stopFace !== 'neutral' || review.stopResult !== 'cancelled') failed = true;
  if (JSON.stringify(review.twoResults) !== JSON.stringify(['interrupted', 'completed']) || review.twoFace !== 'neutral' || review.twoAction !== null) failed = true;
  if (!review.followPairs.some((pair) => pair[0] === 'pointer' && pair[1] === null) || review.followResult !== 'completed') failed = true;
  if (review.keepFace !== 'excited' || review.keepStatus !== 'completed' || review.seenFace !== 'happy' || review.seenRestored !== 'excited' || review.seenStatus !== 'completed') failed = true;
  if (review.keepFollowFace !== 'happy' || review.keepFollowStatus !== 'completed') failed = true;
  if (review.missingStatus !== 'completed' || review.missingFace !== 'neutral' || review.missingAction !== null) failed = true;

  const leakStarted = Date.now();
  const leak = await page.evaluate('window.__leakTest()');
  console.log(`\nLeak: 1,000 create/destroy in ${Date.now() - leakStarted} ms, heap growth ${(leak.growth / 1024 / 1024).toFixed(2)} MB, scheduler=${leak.scheduler} inputs=${leak.inputs} metrics=${leak.metrics} svgs=${leak.svgs}`);
  if (leak.scheduler !== 0 || leak.inputs !== 0 || leak.metrics !== 0 || leak.svgs !== 0) failed = true;
  if (leak.before > 0 && leak.growth > 12 * 1024 * 1024) failed = true;

  const perf = await page.evaluate('window.__perfTest()');
  console.log(`Perf: 50 blubs x ${perf.frames} frames = ${perf.msPerFrame.toFixed(2)} ms/frame, ${perf.usPerBlubFrame.toFixed(1)} us per blub-frame, leftover svgs=${perf.svgs}`);
  if (perf.svgs !== 0) failed = true;

  console.log(`\nmax pixel difference: ${totalDiff}/255 (${totalPixels} differing px across all cases)`);
  console.log(failed ? '\nFAIL' : '\nok');
} finally {
  await browser.close();
  server.close();
}

process.exit(failed ? 1 : 0);
