#!/usr/bin/env node
// Compares the TypeScript build in dist/ against research/golden.json.gz, exactly.
// String equality on JSON.stringify: any changed digit, path or attribute fails.
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as engine from '../dist/engine/index.js';
import * as svg from '../dist/render/svg.js';
import * as names from '../dist/names.js';
import * as resolve from '../dist/resolve.js';

const catalog = { ...names, ...resolve };
import { createBlubModel } from '../dist/internal/model.js';
import { buildDump, stringifyDump } from './golden-dump.mjs';

const goldenPath = fileURLToPath(new URL('../research/golden.json.gz', import.meta.url));
const golden = gunzipSync(fs.readFileSync(goldenPath)).toString('utf8');

let actual;
try {
  actual = `${stringifyDump(buildDump(engine, svg, catalog, createBlubModel))}\n`;
} catch (err) {
  console.error('FAIL  could not build the dump from dist/');
  console.error(err);
  process.exit(1);
}

if (actual === golden) {
  console.log('ok    golden snapshot matches byte for byte');
  process.exit(0);
}

let line = 0;
let at = 0;
while (at < golden.length && at < actual.length && golden[at] === actual[at]) {
  if (golden[at] === '\n') line++;
  at++;
}
const from = Math.max(0, golden.lastIndexOf('\n', at) + 1);
const to = golden.indexOf('\n', at + 200);
console.error(`FAIL  golden snapshot differs at line ${line + 1}, byte ${at}`);
console.error(`  golden: ${JSON.stringify(golden.slice(from, to === -1 ? undefined : to))}`);
const aTo = actual.indexOf('\n', at + 200);
console.error(`  dist:   ${JSON.stringify(actual.slice(from, aTo === -1 ? undefined : aTo))}`);
process.exit(1);
