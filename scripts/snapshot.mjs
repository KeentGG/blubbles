#!/usr/bin/env node
// Regenerates research/golden.json.gz from the current dist/ build.
// The committed file was captured from the original pre-port engine; regenerating it
// replaces that reference with whatever the current code draws. Only run this after an
// intentional visual change, and review the difference before committing.
// `npm run verify:golden` compares dist/ against the file, byte for byte.
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as engine from '../dist/engine/index.js';
import * as svg from '../dist/render/svg.js';
import * as names from '../dist/names.js';
import * as resolve from '../dist/resolve.js';

const catalog = { ...names, ...resolve };
import { createBlubModel } from '../dist/internal/model.js';
import { buildDump, stringifyDump } from './golden-dump.mjs';

const out = new URL('../research/golden.json.gz', import.meta.url);
const dump = buildDump(engine, svg, catalog, createBlubModel);
const json = stringifyDump(dump);
const compressed = gzipSync(Buffer.from(`${json}\n`), { level: 9 });
fs.writeFileSync(out, compressed);

console.log(
  `wrote research/golden.json.gz (${(compressed.length / 1024 / 1024).toFixed(2)} MB, ` +
    `from ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB JSON)`,
);
console.log(
  `  ${dump.samples.length} engine samples, ${dump.timelines.length} timelines, ` +
    `${dump.blubs.length} blubs, ${dump.renderSVG.length} SVGs`,
);
