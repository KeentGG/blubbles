// Frame rendering + animated-avatar encoding for the studio.
import { wearColors } from './catalog.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { BlubEngine, SHAPE_BY_ID, EXPRESSION_BY_ID } from './dist/engine/index.js';
import { renderSVG, autoEye, INK } from './dist/render/svg.js';
import { colorHex } from './dist/resolve.js';

export const PHASE = { 6.8: 6.5, 10.2: 2.18, 13.6: 7.18 };
export const FORMATS = {
  webp: { ext: 'webp', mime: 'image/webp', alpha: true, label: 'Animated WebP' },
  apng: { ext: 'apng', mime: 'image/apng', alpha: true, label: 'APNG' },
  gif: { ext: 'gif', mime: 'image/gif', alpha: true, label: 'GIF' },
  mp4: { ext: 'mp4', mime: 'video/mp4', alpha: false, label: 'MP4 video' },
  png: { ext: 'png', mime: 'image/png', alpha: false, label: 'PNG still' },
  svg: { ext: 'svg', mime: 'image/svg+xml', alpha: false, label: 'SVG still' },
};

export function resolveStyle(cfg) {
  const body = cfg.color?.startsWith('#') ? cfg.color : colorHex(cfg.color);
  let background = null;
  if (cfg.background === 'ink') background = INK;
  else if (cfg.background === 'paper') background = '#ffffff';
  else if (typeof cfg.background === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.background)) background = cfg.background;
  const paper = background ?? autoEye(body);
  const clay = cfg.finish !== 'flat';
  return { body, background, paper, clay };
}

export function makeEngine(cfg) {
  const b = new BlubEngine(
    100,
    'idle',
    SHAPE_BY_ID.get(cfg.shape)?.radii ?? null,
    EXPRESSION_BY_ID.get(cfg.face) ?? null,
  );
  b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
  if (cfg.wear?.length) {
    b.setAccessories(wearColors(cfg), 0, true);
  }
  return b;
}

export function frameSVG(engine, cfg, t, size, uid = 'bot') {
  const st = resolveStyle(cfg);
  const sample = engine.sample(t);
  return renderSVG(sample, {
    color: st.body,
    size,
    crop: 124,
    scale: 158,
    paper: st.paper,
    clay: st.clay,
    uid,
    background: st.background,
  });
}

export function framePNG(engine, cfg, t, size) {
  const svg = frameSVG(engine, cfg, t, size);
  return new Resvg(svg).render().asPng();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code})\n${err}`))));
  });
}

const codecArgs = (format, cfg, size, background) => {
  switch (format) {
    case 'webp':
      return ['-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '88', '-loop', '0', '-pix_fmt', 'yuva420p'];
    case 'apng':
      return ['-plays', '0', '-f', 'apng'];
    case 'gif':
      return [
        '-filter_complex',
        `[0:v]split[a][b];[a]palettegen=reserve_transparent=${background ? 0 : 1}:max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:alpha_threshold=128`,
        '-loop', '0',
      ];
    case 'mp4':
      return ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart'];
    default:
      throw new Error(`unsupported animation format: ${format}`);
  }
};

/**
 * Render an idle loop and encode it.
 * @returns {Promise<{file:string, bytes:number, frames:number}>}
 */
export async function exportAnimation(cfg, outDir, onProgress = () => {}) {
  const format = cfg.format;
  const info = FORMATS[format];
  if (!info) throw new Error('bad format');
  if (!info.alpha && cfg.background === 'transparent') cfg = { ...cfg, background: 'ink' };

  const size = Number(cfg.size) || 512;
  const fps = Number(cfg.fps) || 30;
  const duration = Number(cfg.duration) || 10.2;
  const t0 = PHASE[duration] ?? 2.18;
  const frames = Math.round(duration * fps);

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true, recursive: true });

  const engine = makeEngine(cfg);
  for (let i = 0; i < frames; i++) {
    const png = framePNG(engine, cfg, t0 + i / fps, size);
    fs.writeFileSync(path.join(outDir, `f_${String(i).padStart(5, '0')}.png`), png);
    if (i % 5 === 0 || i === frames - 1) onProgress((i + 1) / frames * 0.9);
  }

  const out = path.join(outDir, `avatar.${info.ext}`);
  const st = resolveStyle(cfg);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(outDir, 'f_%05d.png')];
  if (format === 'mp4') args.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
  args.push(...codecArgs(format, cfg, size, st.background ? true : false), out);
  onProgress(0.94);
  await run('ffmpeg', args);
  onProgress(1);
  return { file: out, bytes: fs.statSync(out).size, frames };
}
