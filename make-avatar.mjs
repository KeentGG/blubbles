#!/usr/bin/env node
// Headless avatar generator. Uses the same engine and encoder as the studio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, exportAnimation, makeEngine, framePNG, frameSVG } from './export.mjs';
import { SHAPES, FACES, COLORS } from './dist/names.js';
import { colorHex, shapeId, faceId } from './dist/resolve.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key.includes('=')) {
      const [k, ...rest] = key.split('=');
      out[k] = rest.join('=');
    } else if (list[i + 1] && !list[i + 1].startsWith('--')) {
      out[key] = list[++i];
    } else out[key] = true;
  }
  return out;
}
const args = parseArgs(argv);

const pickShape = (v) => shapeId(v) ?? 'circle';
const pickFace = (v) => faceId(v) ?? 'neutral';
// Named colours stay names (for file names); anything else resolves to hex.
function pickColor(v) {
  if (!v) return 'blue';
  const value = String(v).trim().toLowerCase();
  if (COLORS[value]) return value;
  return colorHex(value);
}

if (args.help || args.h) {
  console.log(`
  blubbles avatar generator

  node make-avatar.mjs [options]

  --shape     circle | pebble | squircle | capsule | triangle | hexagon | cloud | droplet
  --face      neutral | attentive | surprised | excited | happy | laughing | angry | sad |
              scared | suspicious | confused | curious | proud | shy | unimpressed | sleepy
  --color     ink | cream | brown | red | orange | amber | green | turquoise | blue |
              purple | pink | grey | #rrggbb
  --finish    clay | flat                 (default clay)
  --format    webp | apng | gif | mp4 | png | svg   (default webp)
  --size      64 .. 2048                 (default 512)
  --fps       1 .. 60                    (default 30)
  --duration  6.8 | 10.2 | 13.6          (default 10.2, idle loop)
  --bg        transparent | ink | paper | #rrggbb (default transparent)
  --time      seconds, for png/svg only  (default 0.35)
  --out       output path                (default out/blubbles-<shape>-<face>-<color>-<size>.<ext>)
  --list      print all options and exit
`);
  process.exit(0);
}

if (args.list) {
  console.log('shapes:', SHAPES.join(', '));
  console.log('faces: ', FACES.join(', '));
  console.log('colours:', Object.entries(COLORS).map(([id, hex]) => `${id} (${hex})`).join(', '));
  process.exit(0);
}

const cfg = {
  shape: pickShape(args.shape),
  face: pickFace(args.face),
  color: pickColor(args.color),
  finish: args.finish === 'flat' ? 'flat' : 'clay',
  size: Math.max(64, Math.min(2048, Number(args.size) || 512)),
  fps: Math.max(1, Math.min(60, Number(args.fps) || 30)),
  duration: [6.8, 10.2, 13.6].includes(Number(args.duration)) ? Number(args.duration) : 10.2,
  background: args.bg ?? 'transparent',
  format: String(args.format ?? 'webp'),
};

if (!FORMATS[cfg.format]) {
  console.error(`Unknown format: ${cfg.format}. Try webp, apng, gif, mp4, png or svg.`);
  process.exit(1);
}
if (!['transparent', 'ink', 'paper'].includes(cfg.background) && !/^#[0-9a-f]{6}$/i.test(cfg.background)) {
  console.error('Bad --bg. Use transparent, ink, paper or #rrggbb.');
  process.exit(1);
}
if (cfg.format === 'mp4' && cfg.background === 'transparent') cfg.background = 'ink';

const colorPart = cfg.color.startsWith('#') ? 'custom' : cfg.color;
const defaultOut = path.join(ROOT, 'out', `blubbles-${cfg.shape}-${cfg.face}-${colorPart}-${cfg.size}.${FORMATS[cfg.format].ext}`);
const outPath = path.resolve(args.out ?? defaultOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const engine = makeEngine(cfg);

if (cfg.format === 'png' || cfg.format === 'svg') {
  const t = Number(args.time) || 0.35;
  if (cfg.format === 'png') {
    fs.writeFileSync(outPath, framePNG(engine, cfg, t, cfg.size));
  } else {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${frameSVG(engine, cfg, t, cfg.size, 'cli')}`;
    fs.writeFileSync(outPath, svg);
  }
  console.log(`\n  ${outPath}\n  ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB, ${cfg.size} px still\n`);
  process.exit(0);
}

const tmp = path.join(ROOT, '.work', `cli-${Date.now()}`);
let lastPct = -1;
const result = await exportAnimation(cfg, tmp, (p) => {
  const pct = Math.round(p * 100);
  if (pct !== lastPct) {
    lastPct = pct;
    process.stderr.write(`\r  rendering ${String(pct).padStart(3)}%`);
  }
});
process.stderr.write('\n');
fs.copyFileSync(result.file, outPath);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${outPath}`);
console.log(`  ${FORMATS[cfg.format].label}, ${cfg.size} px, ${result.frames} frames, ${(result.bytes / 1024 / 1024).toFixed(2)} MB\n`);
