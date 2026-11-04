// Focused fidelity check: one known renderSVG frame against research/golden.json.gz.
// The exhaustive check lives in scripts/verify-golden.mjs (`npm run verify:golden`).
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { BlubEngine, SHAPE_BY_ID, EXPRESSION_BY_ID } from './dist/engine/index.js';
import { renderSVG } from './dist/render/svg.js';

const goldenUrl = new URL('./research/golden.json.gz', import.meta.url);
const golden = JSON.parse(gunzipSync(fs.readFileSync(goldenUrl)).toString('utf8'));
const entry = golden.renderSVG.find((frame) => frame.key === 'pebble-happy-clay');
if (!entry) {
  console.error('FAIL  research/golden.json.gz is missing the pebble-happy-clay frame');
  process.exit(1);
}

const b = new BlubEngine(100, 'idle', SHAPE_BY_ID.get('pebble').radii, EXPRESSION_BY_ID.get('happy'));
b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
const ours = renderSVG(b.sample(entry.t), entry.opts);

const body = (svg) => svg.match(/<path d="([^"]+)" fill="#fff"/)?.[1];
const eyes = (svg) => [...svg.matchAll(/transform="(matrix\([^"]+\))"/g)].map((m) => m[1]);
const stops = (svg) => [...svg.matchAll(/<stop offset="[^"]*" stop-color="([^"]*)"/g)].map((m) => m[1]);

const checks = [
  ['body path', body(entry.svg), body(ours)],
  ['eye matrices', eyes(entry.svg).join(' | '), eyes(ours).join(' | ')],
  ['gradient stops', stops(entry.svg).join(' '), stops(ours).join(' ')],
  ['full SVG', entry.svg, ours],
];

let ok = true;
for (const [name, expected, actual] of checks) {
  const pass = expected === actual;
  ok = ok && pass;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${pass ? '' : `\n  golden: ${expected}\n  ours:   ${actual}`}`);
}
console.log(`\nChecked pebble / happy / blue at t = ${entry.t}, against research/golden.json.gz.`);
process.exit(ok ? 0 : 1);
