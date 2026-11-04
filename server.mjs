import { parseWear } from './catalog.mjs';
// Tiny static server + async export API for Blubbles Studio.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportAnimation, FORMATS } from './export.mjs';
import { shapeId, faceId, colorId } from './dist/resolve.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(ROOT, '.work', 'jobs');
fs.mkdirSync(WORK, { recursive: true });
for (const name of fs.readdirSync(WORK)) {
  const p = path.join(WORK, name);
  try {
    if (Date.now() - fs.statSync(p).mtimeMs > 60 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}
for (const name of fs.readdirSync(path.join(ROOT, '.work'))) {
  if (!name.startsWith('cli-')) continue;
  const p = path.join(ROOT, '.work', name);
  try {
    if (Date.now() - fs.statSync(p).mtimeMs > 60 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

const PORT = Number(process.env.PORT) || 4300;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const jobs = new Map();

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (v) => typeof v === 'string' && HEX.test(v);

function safeConfig(raw) {
  // Engine ids are English now; legacy French ids from old payloads still resolve.
  // Empty strings (blank form fields) fall back to the defaults, like missing ones.
  const pick = (v, fallback) => (v == null || v === '' ? fallback : String(v).trim());
  const shape = shapeId(pick(raw.shape, 'circle'));
  const face = faceId(pick(raw.face, 'neutral'));
  const colorInput = pick(raw.color, 'blue').toLowerCase();
  const color = isHex(colorInput) ? colorInput : colorId(colorInput);
  const finish = raw.finish === 'flat' ? 'flat' : 'clay';
  if (!shape) throw new Error('Unknown shape');
  if (!face) throw new Error('Unknown face');
  if (!color) throw new Error('Unknown colour');

  const format = String(raw.format || 'webp');
  if (!FORMATS[format] || !['webp', 'apng', 'gif', 'mp4'].includes(format)) throw new Error('Unknown format');

  const size = Number(raw.size);
  if (![128, 256, 512, 1024].includes(size)) throw new Error('Bad size');

  const fps = Number(raw.fps);
  if (![15, 24, 30].includes(fps)) throw new Error('Bad fps');

  const duration = Number(raw.duration);
  if (![6.8, 10.2, 13.6].includes(duration)) throw new Error('Bad duration');

  let background = raw.background ?? 'transparent';
  if (!['transparent', 'ink', 'paper'].includes(background) && !isHex(background)) throw new Error('Bad background');

  const wear = parseWear(raw.wear);
  const tone = isHex(raw.tone) ? raw.tone : null;
  const unify = raw.unify === true || tone !== null;
  const tones = {};
  for (const slot of ['head', 'neck', 'lip']) {
    if (isHex(raw.tones?.[slot])) tones[slot] = raw.tones[slot];
  }

  return { shape, face, color, finish, wear, unify, tone, tones, format, size, fps, duration, background };
}

function filenameFor(cfg) {
  const s = cfg.shape;
  const f = cfg.face;
  const c = isHex(cfg.color) ? 'custom' : cfg.color;
  return `blubbles-${s}-${f}-${c}-${cfg.size}.${FORMATS[cfg.format].ext}`;
}

async function handleExport(req, res) {
  let raw;
  try { raw = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'Bad JSON' }); }
  let cfg;
  try { cfg = safeConfig(raw); } catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const id = crypto.randomUUID();
  const dir = path.join(WORK, id);
  const job = {
    id, cfg, state: 'rendering', progress: 0, message: 'Setting up', createdAt: Date.now(),
    url: `/api/jobs/${id}/file`, filename: filenameFor(cfg), bytes: 0, frames: 0,
  };
  jobs.set(id, job);
  sendJSON(res, 202, { id });

  (async () => {
    try {
      job.message = 'Rendering frames';
      const result = await exportAnimation(cfg, dir, (p) => {
        job.progress = Math.min(0.93, p * 0.93);
        if (p > 0.9) job.message = 'Encoding';
      });
      job.progress = 1;
      job.state = 'done';
      job.message = 'Ready';
      job.bytes = result.bytes;
      job.frames = result.frames;
      job.file = result.file;
    } catch (err) {
      job.state = 'error';
      job.message = err.message?.split('\n')[0] || 'Export failed';
      console.error('[export]', id, err);
    }
  })();

  setTimeout(() => {
    const j = jobs.get(id);
    if (j && Date.now() - j.createdAt > 30 * 60 * 1000) {
      jobs.delete(id);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30 * 60 * 1000).unref();
}

function serveFile(res, file, downloadName) {
  if (!file || !fs.existsSync(file)) return sendJSON(res, 404, { error: 'Not found' });
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = decodeURIComponent(url.pathname);

  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/export' && req.method === 'POST') return handleExport(req, res);
      if (p === '/api/health') return sendJSON(res, 200, { ok: true });
      const m = p.match(/^\/api\/jobs\/([\w-]+)(\/file)?$/);
      if (m) {
        const job = jobs.get(m[1]);
        if (!job) return sendJSON(res, 404, { error: 'Unknown job' });
        if (m[2]) {
          if (job.state !== 'done') return sendJSON(res, 409, { error: 'Still rendering' });
          return serveFile(res, job.file, job.filename);
        }
        if (req.method === 'DELETE') {
          jobs.delete(job.id);
          fs.rmSync(path.join(WORK, job.id), { recursive: true, force: true });
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 200, {
          id: job.id, state: job.state, progress: job.progress, message: job.message,
          url: job.state === 'done' ? job.url : null, filename: job.filename,
          bytes: job.bytes, frames: job.frames,
        });
      }
      return sendJSON(res, 404, { error: 'Not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Method not allowed' });

    let file;
    if (p === '/' || p === '/index.html') file = path.join(ROOT, 'studio', 'index.html');
    else if (p === '/app.js') file = path.join(ROOT, 'studio', 'app.js');
    else if (p === '/style.css') file = path.join(ROOT, 'studio', 'style.css');
    else if (p.startsWith('/fonts/')) file = path.join(ROOT, 'studio', 'fonts', path.basename(p));
    else if (p === '/catalog.mjs') file = path.join(ROOT, p.slice(1));
    else if (p.startsWith('/dist/') && p.endsWith('.js')) {
      const candidate = path.resolve(ROOT, p.slice(1));
      if (!candidate.startsWith(path.join(ROOT, 'dist') + path.sep)) return sendJSON(res, 404, { error: 'Not found' });
      file = candidate;
    }
    else return sendJSON(res, 404, { error: 'Not found' });

    return serveFile(res, file);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Server error' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is busy. Try: PORT=4310 npm start\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Blubbles Studio  ->  http://${HOST}:${PORT}\n`);
});
