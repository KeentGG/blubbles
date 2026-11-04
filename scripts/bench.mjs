#!/usr/bin/env node
// Frame-cost benchmark: sample() µs/frame and heap growth over 10k frames.
import { performance } from 'node:perf_hooks';
import { BlubEngine, EXPRESSION_BY_ID, SHAPE_BY_ID } from '../dist/engine/index.js';

const FRAMES = 10000;
const engine = new BlubEngine(100, 'idle', SHAPE_BY_ID.get('pebble').radii, EXPRESSION_BY_ID.get('happy'));
engine.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);

for (let i = 0; i < 1000; i++) engine.sample(i / 60);
if (global.gc) global.gc();
const before = process.memoryUsage().heapUsed;
const start = performance.now();
for (let i = 0; i < FRAMES; i++) engine.sample(i / 60);
const elapsed = performance.now() - start;
if (global.gc) global.gc();
const after = process.memoryUsage().heapUsed;

console.log(`sample(): ${((elapsed * 1000) / FRAMES).toFixed(2)} us/frame over ${FRAMES} frames`);
console.log(`heap: ${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB (${((after - before) / 1024 / 1024).toFixed(2)} MB)`);
