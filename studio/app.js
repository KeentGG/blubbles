// Blubbles Studio: live renderer, controls and exports.
import {
  BlubEngine, SHAPE_BY_ID, EXPRESSION_BY_ID,
  renderSampleSVG as renderSVG, autoEye, INK, accessoryPartColor,
} from '/dist/engine-entry.js';
import {
  shapeOptions, faceOptions, colorOptions, moveOptions, wearOptions,
  parseConfig, configQuery, durationOf, randomConfig, wearColors,
} from '/catalog.mjs';
import { SHAPE_LABEL, FACE_LABEL, COLOR_LABEL } from '/dist/names.js';
import { colorHex } from '/dist/resolve.js';
import { createBlub } from '/dist/index.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
const PAPER_BG = '#ffffff';
const INK_BG = INK;
const STAGE_HEX = { paper: '#f5f6f2', ink: '#0b0e0c' };

const el = {
  brand: $('brand-mark'), linkState: $('link-state'), copyLink: $('copy-link'),
  aboutOpen: $('about-open'), theme: $('theme-toggle'), themeLabel: $('theme-label'),
  stage: $('stage'), follow: $('follow-toggle'), play: $('play-toggle'), bg: $('bg-toggle'),
  preview: $('preview'), caption: $('caption'), captionNote: $('caption-note'), moves: $('moves'),
  wearGrid: $('wear-grid'), wearRows: $('wear-rows'), wearUnify: $('wear-unify'), wearUnifyInput: $('wear-unify-input'), wearUnifyLabel: $('wear-unify-label'), wearEmpty: $('wear-empty'), surprise: $('surprise'), shapeGrid: $('shape-grid'), faceGrid: $('face-grid'), swatchGrid: $('swatch-grid'),
  colorChip: $('color-chip'), colorLabel: $('color-label'), hex: $('hex-input'),
  pick: $('pick-color'), nativeColor: $('native-color'), finishNote: $('finish-note'),
  exportSummary: $('export-summary'), formatRow: $('format-row'), bgSeg: $('bg-seg'),
  size: $('size-select'), duration: $('duration-select'), fps: $('fps-select'),
  hint: $('format-hint'), exportBtn: $('export-btn'), exportLabel: $('export-label'),
  exportMeta: $('export-meta'), progress: $('progress'), progressBar: $('progress-bar'),
  progressLabel: $('progress-label'), progressPct: $('progress-pct'), done: $('done'),
  doneText: $('done-text'), doneLink: $('done-link'), estimate: $('estimate'),
  png: $('download-png'), svg: $('download-svg'), about: $('about'), aboutClose: $('about-close'),
  aboutOk: $('about-ok'), toast: $('toast'), bell: $('bell'),
  momentPresets: $('moment-presets'), momentStatus: $('moment-status'), momentStop: $('moment-stop'),
  momentJson: $('moment-json'), momentPlay: $('moment-play'), momentError: $('moment-error'),
};

const state = {
  ...parseConfig(location.search),
  bg: store.get('blubbles.bg') || 'paper',
  follow: true,
  playing: !reduceMotion,
  move: null,
  tab: 'shape',
  export: {
    format: 'webp',
    size: 512,
    duration: 10.2,
    fps: 30,
    background: 'transparent',
  },
};

const bodyColor = () => (isHex(state.color) ? state.color.toLowerCase() : colorHex(state.color));
const colorTitle = () => (isHex(state.color) ? 'Custom' : COLOR_LABEL[state.color] ?? 'Colour');
const colorSlug = () => (isHex(state.color) ? 'custom' : state.color);
const stagePaper = () => (state.bg === 'paper' ? STAGE_HEX.paper : state.bg === 'ink' ? STAGE_HEX.ink : null);

/* live stage: one createBlub owns the clock and the SVG */
const wearList = () => wearColors(state);
const TONES = ['#1f2233', '#f6f0e4', '#c8324a', '#e0a526', '#1f6b4a', '#2a4fb0'];
// A mustache is hair first: natural colours, then a couple of loud ones.
const LIP_TONES = ['#6b4226', '#b5651d', '#a8a59c', '#f6f0e4', '#c8324a', '#2a4fb0'];

function createEngine() {
  const b = new BlubEngine(
    100,
    'idle',
    SHAPE_BY_ID.get(state.shape)?.radii ?? null,
    EXPRESSION_BY_ID.get(state.face) ?? null,
  );
  b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
  b.setAccessories(wearList(), 0, true);
  return b;
}

const initialPaper = stagePaper();
const stageBlub = createBlub(el.preview, {
  shape: state.shape,
  face: state.face,
  color: state.color,
  finish: state.finish,
  accessories: wearList(),
  paper: initialPaper ?? autoEye(bodyColor()),
  eye: initialPaper ?? autoEye(bodyColor()),
  size: 640,
  status: 'idle',
  ariaLabel: 'Live blub preview',
});
stageBlub.el.style.width = '100%';
stageBlub.el.style.height = 'auto';

function syncStageStyle() {
  const paper = stagePaper() ?? autoEye(bodyColor());
  stageBlub.set({ paper, eye: paper }, { duration: 0 });
}

if (state.follow) stageBlub.follow('pointer', { onLeave: 'wander' });
else stageBlub.follow(null);
if (!state.playing) stageBlub.pause();

/* ui builders */
function thumbSVG({ shape, face, uid, wear = wearList() }) {
  const color = bodyColor();
  const b = new BlubEngine(100, 'idle', SHAPE_BY_ID.get(shape).radii, EXPRESSION_BY_ID.get(face));
  b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
  b.setAccessories(wear, 0, true);
  const s = b.sample(2.18);
  return renderSVG(s, {
    color, size: 120, crop: 124, scale: 158,
    paper: autoEye(color), clay: state.finish === 'clay', uid, background: null,
  });
}

function buildGrids() {
  el.shapeGrid.innerHTML = shapeOptions.map((o) => (
    `<button type="button" class="option" data-shape="${o.id}" aria-label="${o.label}">
      <span class="opt-art" data-thumb="s-${o.id}"></span>
      <span class="opt-name">${o.label}</span>
    </button>`
  )).join('');

  el.faceGrid.innerHTML = faceOptions.map((o) => (
    `<button type="button" class="option" data-face="${o.id}" aria-label="${o.label}">
      <span class="opt-art" data-thumb="f-${o.id}"></span>
      <span class="opt-name">${o.label}</span>
    </button>`
  )).join('');

  el.swatchGrid.innerHTML = colorOptions.map((o) => (
    `<button type="button" class="swatch" data-color="${o.id}" style="--c:${o.hex}" title="${o.label} ${o.hex}" aria-label="${o.label}"></button>`
  )).join('');

  el.wearGrid.innerHTML = wearOptions.map((o) => (
    `<button type="button" class="option" data-wear="${o.id}" aria-pressed="false" aria-label="${o.label}">
      <span class="opt-art" data-thumb="w-${o.id}"></span>
      <span class="opt-name">${o.label}</span>
    </button>`
  )).join('');

  el.moves.innerHTML = moveOptions.map((o) => (
    `<button type="button" class="move-btn${o.id === 'idle' ? ' is-active' : ''}" data-move="${o.id}">${o.label}</button>`
  )).join('');
}

function refreshThumbs() {
  const color = bodyColor();
  for (const o of shapeOptions) {
    const host = document.querySelector(`[data-thumb="s-${o.id}"]`);
    if (host) host.innerHTML = thumbSVG({ shape: o.id, face: state.face, uid: `sh-${o.id}` });
  }
  for (const o of faceOptions) {
    const host = document.querySelector(`[data-thumb="f-${o.id}"]`);
    if (host) host.innerHTML = thumbSVG({ shape: state.shape, face: o.id, uid: `fa-${o.id}` });
  }
  for (const o of wearOptions) {
    const host = document.querySelector(`[data-thumb="w-${o.id}"]`);
    if (host) {
      // Each card shows that item alone, on your blub, whatever else is worn.
      host.innerHTML = thumbSVG({
        shape: state.shape, face: state.face, uid: `we-${o.id}`,
        wear: wearColors({ ...state, wear: [o.id] }),
      });
    }
  }
  document.documentElement.style.setProperty('--bot', color);
}

const wearName = (id) => wearOptions.find((o) => o.id === id).label;
const wornIn = (slot) => state.wear.find((id) => wearOptions.find((o) => o.id === id).slot === slot);
/** The colour rows the current outfit needs, in the order worn things sit on the body. */
function wearColorRows() {
  const head = wornIn('head');
  const neck = wornIn('neck');
  const lip = wornIn('lip');
  const rows = [];
  if (state.unify && head && neck) {
    rows.push({ slot: 'all', label: `${wearName(head)} and ${wearName(neck).toLowerCase()}`, value: state.tone });
  } else {
    const shared = (slot) => (state.unify ? state.tone : state.tones[slot]) ?? null;
    if (head) rows.push({ slot: 'head', label: wearName(head), value: shared('head') });
    if (neck) rows.push({ slot: 'neck', label: wearName(neck), value: shared('neck') });
  }
  if (lip) rows.push({ slot: 'lip', label: wearName(lip), value: state.tones.lip ?? null });
  return rows;
}
let wearRowsKey = '';
function syncWearColors() {
  const rows = wearColorRows();
  // The default swatch says what it does: black on most bodies, cream on a very dark one.
  const lipDefault = accessoryPartColor({ color: 'lip', shade: 0 }, bodyColor()) === '#000000' ? 'Black' : 'Cream';
  const key = rows.map((r) => `${r.slot}:${r.label}`).join('|') + lipDefault;
  if (key !== wearRowsKey) {
    wearRowsKey = key;
    el.wearRows.innerHTML = rows.map((r) => {
      const isLip = r.slot === 'lip';
      const swatches = (isLip ? LIP_TONES : TONES).map((hex) => (
        `<button type="button" class="tone-btn" data-tone="${hex}" style="--c:${hex}" aria-label="${r.label} colour ${hex}"></button>`
      )).join('');
      return `<div class="wear-color">
        <span class="micro" id="tone-${r.slot}">${r.label}</span>
        <div class="tone-row" role="group" aria-labelledby="tone-${r.slot}" data-tone-slot="${r.slot}">
          <button type="button" class="tone-btn" data-tone="auto" title="${isLip ? 'The default mustache colour' : 'Picked from the body colour'}">${isLip ? lipDefault : 'Auto'}</button>${swatches}
        </div>
      </div>`;
    }).join('');
  }
  for (const r of rows) {
    el.wearRows.querySelectorAll(`[data-tone-slot="${r.slot}"] [data-tone]`).forEach((b) => {
      b.classList.toggle('is-on', b.dataset.tone === (r.value ?? 'auto'));
    });
  }
  const head = wornIn('head');
  const neck = wornIn('neck');
  el.wearUnify.hidden = !(head && neck);
  if (head && neck) el.wearUnifyLabel.textContent = `Same colour for ${wearName(head).toLowerCase()} and ${wearName(neck).toLowerCase()}`;
  el.wearUnifyInput.checked = state.unify;
  el.wearEmpty.hidden = rows.length > 0;
}

function syncSelection() {
  document.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('is-on', b.dataset.shape === state.shape));
  document.querySelectorAll('[data-face]').forEach((b) => b.classList.toggle('is-on', b.dataset.face === state.face));
  document.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('is-on', b.dataset.color === state.color));
  document.querySelectorAll('[data-wear]').forEach((b) => {
    const on = state.wear.includes(b.dataset.wear);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  syncWearColors();
  el.colorChip.style.background = bodyColor();
  el.colorLabel.textContent = colorTitle();
  if (document.activeElement !== el.hex) el.hex.value = bodyColor().toUpperCase();
  el.nativeColor.value = bodyColor();
}

function syncCaption() {
  el.caption.innerHTML = `${SHAPE_LABEL[state.shape]} <span>/</span> ${FACE_LABEL[state.face]} <span>/</span> ${colorTitle()}`;
}

function syncMoves() {
  document.querySelectorAll('[data-move]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.move === (state.move ?? 'idle'));
  });
}

function syncFinish() {
  document.querySelectorAll('[data-finish]').forEach((b) => b.classList.toggle('is-on', b.dataset.finish === state.finish));
  el.finishNote.textContent = state.finish === 'clay' ? 'Clay adds the light.' : 'Flat and graphic.';
}

function syncBg() {
  el.stage.dataset.bg = state.bg;
  el.bg.textContent = state.bg === 'paper' ? 'Paper' : state.bg === 'ink' ? 'Ink' : 'Checker';
  store.set('blubbles.bg', state.bg);
}

function syncFollow() {
  el.follow.classList.toggle('is-on', state.follow);
  el.follow.setAttribute('aria-pressed', String(state.follow));
  el.captionNote.textContent = state.follow
    ? (coarsePointer ? 'It blinks and breathes on its own.' : 'Move your cursor. It will look.')
    : 'Gaze is resting.';
}

function syncPlay() {
  el.play.textContent = state.playing ? 'Pause' : 'Play';
  el.play.classList.toggle('is-on', !state.playing);
}

let urlTimer;
function syncURL() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const url = `${location.pathname}${configQuery(state)}`;
    history.replaceState(null, '', url);
    el.linkState.textContent = 'Link saves your bot';
    el.linkState.classList.add('is-flash');
    setTimeout(() => el.linkState.classList.remove('is-flash'), 700);
  }, 120);
}

let syncQueued = false;
function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncSelection();
    syncCaption();
    syncFinish();
    refreshThumbs();
    syncURL();
  });
}

/* actions */
function setShape(id) {
  if (!SHAPE_BY_ID.has(id)) return;
  stopMoment('Stopped');
  state.shape = id;
  stageBlub.set({ shape: id });
  scheduleSync();
}
function setFace(id) {
  if (!EXPRESSION_BY_ID.has(id)) return;
  stopMoment('Stopped');
  state.face = id;
  stageBlub.set({ face: id });
  scheduleSync();
}
function setColor(value) {
  if (value !== 'custom' && !isHex(value) && !colorOptions.some((c) => c.id === value)) return;
  stopMoment('Stopped');
  state.color = value === 'custom' ? bodyColor() : value;
  stageBlub.set({ color: state.color }, { duration: 0 });
  syncStageStyle();
  scheduleSync();
}
function toggleWear(id) {
  stopMoment('Stopped');
  const on = state.wear.includes(id);
  const slot = wearOptions.find((o) => o.id === id).slot;
  const others = state.wear.filter((w) => wearOptions.find((o) => o.id === w).slot !== slot);
  state.wear = on ? others : [...others, id];
  stageBlub.set({ accessories: wearList() });
  scheduleSync();
}
function setTone(slot, value) {
  stopMoment('Stopped');
  const hex = value === 'auto' ? null : value;
  if (slot === 'all' || (state.unify && slot !== 'lip')) state.tone = hex;
  else state.tones = { ...state.tones, [slot]: hex };
  stageBlub.set({ accessories: wearList() });
  scheduleSync();
}
function setUnify(on) {
  stopMoment('Stopped');
  if (on) {
    // Nothing should jump: the shared colour starts as the one already showing.
    state.tone = state.tones.head ?? state.tones.neck ?? null;
  } else {
    // Each item keeps the shared colour until it is changed.
    state.tones = { ...state.tones, head: state.tone, neck: state.tone };
    state.tone = null;
  }
  state.unify = on;
  stageBlub.set({ accessories: wearList() });
  scheduleSync();
}
function setFinish(value) {
  stopMoment('Stopped');
  state.finish = value === 'flat' ? 'flat' : 'clay';
  stageBlub.set({ finish: state.finish });
  scheduleSync();
}

const MOVE_ACTIONS = {
  wink: 'wink', notify: 'notify', exclaim: 'exclaim', egg: 'hatch', hexagon: 'crystallize',
  play: 'celebrate', orbit: 'orbit', swirl: 'swirl', burst: 'burst', comet: 'comet',
};
const MOVE_STATUSES = { thinking: 'thinking', wide: 'listening', alert: 'alert', sleep: 'sleeping' };
let moveTimer = 0;
let moveToken = 0;
let moveStartedAt = 0;

function clearMove() {
  moveToken++;
  clearTimeout(moveTimer);
  moveTimer = 0;
  state.move = null;
  syncMoves();
}

function ensurePlaying() {
  if (state.playing) return;
  state.playing = true;
  stageBlub.resume();
  syncPlay();
}

function playMove(id) {
  interruptMoment();
  clearMove();
  if (id !== 'idle') ensurePlaying();
  const token = ++moveToken;
  moveStartedAt = stageBlub.time;
  state.move = id === 'idle' ? null : id;
  if (id === 'idle') {
    stageBlub.status('idle');
  } else if (MOVE_ACTIONS[id]) {
    const action = MOVE_ACTIONS[id];
    stageBlub.play(action, { interrupt: true }).then(() => {
      if (token === moveToken && state.move === id) {
        state.move = null;
        syncMoves();
      }
    });
  } else if (MOVE_STATUSES[id]) {
    stageBlub.status(MOVE_STATUSES[id]);
    moveTimer = setTimeout(() => {
      if (token === moveToken && state.move === id) {
        state.move = null;
        stageBlub.status('idle');
        syncMoves();
      }
    }, durationOf(id) * 1000);
  }
  syncMoves();
}

/* preview controls */
el.shapeGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shape]');
  if (b) setShape(b.dataset.shape);
});
el.faceGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-face]');
  if (b) setFace(b.dataset.face);
});
el.swatchGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) setColor(b.dataset.color);
});
el.wearGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wear]');
  if (b) toggleWear(b.dataset.wear);
});
el.wearUnifyInput.addEventListener('change', () => setUnify(el.wearUnifyInput.checked));
el.wearRows.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tone]');
  if (b) setTone(b.closest('[data-tone-slot]').dataset.toneSlot, b.dataset.tone);
});
el.moves.addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]');
  if (b) playMove(b.dataset.move);
});

document.querySelectorAll('[data-finish]').forEach((b) => b.addEventListener('click', () => setFinish(b.dataset.finish)));

el.pick.addEventListener('click', () => {
  if (typeof el.nativeColor.showPicker === 'function') {
    try { el.nativeColor.showPicker(); } catch { el.nativeColor.click(); }
  } else el.nativeColor.click();
});
el.nativeColor.addEventListener('input', () => setColor(el.nativeColor.value.toLowerCase()));
el.hex.addEventListener('input', () => {
  let v = el.hex.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (isHex(v)) setColor(v.toLowerCase());
});
el.hex.addEventListener('blur', () => {
  if (!isHex(el.hex.value)) el.hex.value = bodyColor().toUpperCase();
});
el.hex.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.hex.blur();
});

el.surprise.addEventListener('click', () => {
  stopMoment('Stopped');
  const r = randomConfig();
  setShape(r.shape);
  setFace(r.face);
  setColor(r.color);
  const pool = moveOptions.filter((m) => m.id !== 'idle');
  playMove(pool[Math.floor(Math.random() * pool.length)].id);
});

el.follow.addEventListener('click', () => {
  state.follow = !state.follow;
  if (state.follow) stageBlub.follow('pointer', { onLeave: 'wander' });
  else stageBlub.follow(null);
  syncFollow();
});

el.play.addEventListener('click', () => {
  state.playing = !state.playing;
  if (state.playing) stageBlub.resume();
  else stageBlub.pause();
  syncPlay();
});

el.bg.addEventListener('click', () => {
  state.bg = state.bg === 'paper' ? 'ink' : state.bg === 'ink' ? 'checker' : 'paper';
  syncBg();
  syncStageStyle();
});

/* tabs */
const tabs = [...document.querySelectorAll('.tab')];
function setTab(name) {
  state.tab = name;
  for (const tab of tabs) {
    const on = tab.dataset.pane === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  for (const pane of document.querySelectorAll('.pane')) pane.hidden = pane.id !== `pane-${name}`;
}
tabs.forEach((tab) => {
  tab.addEventListener('click', () => setTab(tab.dataset.pane));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabs.indexOf(tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    setTab(next.dataset.pane);
  });
});

/* theme */
function drawLogo() {
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#121613';
  const surface = css.getPropertyValue('--surface').trim() || '#f8f9f6';
  const b = new BlubEngine(100, 'idle', SHAPE_BY_ID.get('circle').radii, EXPRESSION_BY_ID.get('happy'));
  b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
  const s = b.sample(2.18);
  el.brand.innerHTML = renderSVG(s, {
    color: ink, size: 64, crop: 124, scale: 158, paper: surface, clay: true, uid: 'logo', background: null,
  });
}
function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  store.set('blubbles.theme', mode);
  el.themeLabel.textContent = mode === 'dark' ? 'Light' : 'Dark';
  el.theme.setAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  drawLogo();
}
const savedTheme = store.get('blubbles.theme');
const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
el.theme.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* copy link */
el.copyLink.addEventListener('click', async () => {
  try {
    const url = `${location.origin}${location.pathname}${configQuery(state)}`;
    history.replaceState(null, '', url);
    await navigator.clipboard.writeText(url);
    toast('Link copied');
    el.linkState.textContent = 'Copied';
    setTimeout(() => { el.linkState.textContent = 'Link saves your bot'; }, 2000);
  } catch {
    toast('Could not access the clipboard');
  }
});

/* about */
el.aboutOpen.addEventListener('click', () => el.about.showModal());
el.aboutClose.addEventListener('click', () => el.about.close());
el.aboutOk.addEventListener('click', () => el.about.close());
el.about.addEventListener('click', (e) => {
  if (e.target === el.about) el.about.close();
});

/* export settings */
const FORMAT_HINTS = {
  webp: 'Animated WebP keeps soft alpha and stays small. The safe modern pick.',
  apng: 'APNG is lossless with full alpha. Bigger, but pixel perfect.',
  gif: 'GIF works almost everywhere, but only one transparent colour. 256 px is kinder.',
  mp4: 'MP4 plays everywhere and has no alpha, so it renders on Ink or Paper.',
};
const BPP = { webp: 0.75, apng: 2.2, gif: 2.2, mp4: 0.04 };

function bytesLabel(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
function estimateBytes() {
  const { format, size, duration, fps, background } = state.export;
  const frames = Math.round(duration * fps);
  const base = BPP[format] * size ** 1.5 * frames * (background === 'transparent' ? 1.05 : 0.9);
  return { bytes: base, frames };
}

function syncExport() {
  const ex = state.export;
  if (ex.format === 'mp4' && ex.background === 'transparent') ex.background = 'ink';
  document.querySelectorAll('[data-format]').forEach((b) => b.classList.toggle('is-on', b.dataset.format === ex.format));
  document.querySelectorAll('#bg-seg [data-bg]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.bg === ex.background);
    b.disabled = ex.format === 'mp4' && b.dataset.bg === 'transparent';
  });
  el.size.value = String(ex.size);
  el.duration.value = String(ex.duration);
  el.fps.value = String(ex.fps);
  el.hint.textContent = FORMAT_HINTS[ex.format];
  const { bytes, frames } = estimateBytes();
  const gifWarn = ex.format === 'gif' && ex.size > 256 ? ' GIF at this size is heavy, 256 px is recommended.' : '';
  el.estimate.textContent = `About ${bytesLabel(bytes)}, ${frames} frames.${gifWarn}`;
  el.exportMeta.textContent = `${ex.duration} s`;
  el.exportSummary.textContent = `Idle loop / ${ex.duration} s`;
}

el.formatRow.addEventListener('click', (e) => {
  const b = e.target.closest('[data-format]');
  if (!b) return;
  state.export.format = b.dataset.format;
  syncExport();
});
el.bgSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bg]');
  if (!b || b.disabled) return;
  state.export.background = b.dataset.bg;
  syncExport();
});
el.size.addEventListener('change', () => { state.export.size = Number(el.size.value); syncExport(); });
el.duration.addEventListener('change', () => { state.export.duration = Number(el.duration.value); syncExport(); });
el.fps.addEventListener('change', () => { state.export.fps = Number(el.fps.value); syncExport(); });

/* export job */
let pollTimer = null;
let exportBusy = false;

function setProgress(p, label) {
  const pct = Math.round(clamp(p, 0, 1) * 100);
  el.progress.hidden = false;
  el.progressBar.style.width = `${pct}%`;
  el.progressPct.textContent = `${pct}%`;
  el.progress.setAttribute('aria-valuenow', String(pct));
  if (label) el.progressLabel.textContent = label;
}

async function startExport() {
  if (exportBusy) return;
  exportBusy = true;
  el.done.hidden = true;
  el.progress.hidden = false;
  setProgress(0.01, 'Warming up');
  el.exportBtn.disabled = true;
  el.exportLabel.textContent = 'Rendering';
  el.exportMeta.textContent = `${state.export.duration} s`;

  const payload = {
    shape: state.shape,
    face: state.face,
    color: state.color,
    finish: state.finish,
    wear: state.wear,
    unify: state.unify,
    tone: state.tone,
    tones: state.tones,
    ...state.export,
  };

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(err.error || 'Export failed');
    }
    const { id } = await res.json();
    pollJob(id);
  } catch (err) {
    exportBusy = false;
    el.exportBtn.disabled = false;
    el.exportLabel.textContent = 'Render animation';
    el.progress.hidden = true;
    toast(err.message || 'Export failed');
  }
}

async function pollJob(id) {
  clearTimeout(pollTimer);
  try {
    const res = await fetch(`/api/jobs/${id}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Lost the export job');
    const job = await res.json();
    if (job.state === 'error') throw new Error(job.message || 'Export failed');
    setProgress(job.progress, job.message);
    if (job.state === 'done') {
      exportBusy = false;
      el.exportBtn.disabled = false;
      el.exportLabel.textContent = 'Render again';
      el.done.hidden = false;
      el.doneText.textContent = `${bytesLabel(job.bytes)}, ${job.frames} frames`;
      el.doneLink.href = job.url;
      el.doneLink.download = job.filename;
      setProgress(1, 'Ready');
      const a = document.createElement('a');
      a.href = job.url;
      a.download = job.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Animation ready');
      return;
    }
    pollTimer = setTimeout(() => pollJob(id), 360);
  } catch (err) {
    exportBusy = false;
    el.exportBtn.disabled = false;
    el.exportLabel.textContent = 'Try again';
    el.progressLabel.textContent = err.message || 'Export failed';
    toast(err.message || 'Export failed');
  }
}

el.exportBtn.addEventListener('click', startExport);

/* stills */
function exportBackground() {
  if (state.export.background === 'ink') return INK_BG;
  if (state.export.background === 'paper') return PAPER_BG;
  return null;
}
function stillSVG(size) {
  const bg = exportBackground();
  const paper = bg ?? autoEye(bodyColor());
  const b = createEngine();
  b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0);
  let sampleTime;
  if (state.move) {
    b.setState(state.move, 0);
    sampleTime = Math.max(0, stageBlub.time - moveStartedAt);
  } else {
    sampleTime = Math.max(0.35, stageBlub.time);
  }
  const s = b.sample(sampleTime);
  return renderSVG(s, {
    color: bodyColor(), size, crop: 124, scale: 158,
    paper, clay: state.finish === 'clay', uid: 'still', background: bg,
  });
}
function filename(ext) {
  const shape = state.shape;
  const face = state.face;
  return `blubbles-${shape}-${face}-${colorSlug()}-${state.export.size}.${ext}`;
}
function download(file, name) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

el.svg.addEventListener('click', () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${stillSVG(state.export.size)}`;
  download(new Blob([svg], { type: 'image/svg+xml' }), filename('svg'));
  toast('SVG saved');
});

el.png.addEventListener('click', async () => {
  const size = state.export.size;
  try {
    const svg = stillSVG(size);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const file = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'));
    download(file, filename('png'));
    toast('PNG saved');
  } catch {
    toast('Could not draw the PNG');
  }
});


/* moments */
const MOMENT_DEFAULT = '[{ "face":"surprised", "look":"#bell", "play":"notify" }, { "wait":0.4 }, { "face":"happy", "hold":0.6 }]';
const MOMENT_PRESETS = {
  newNotification: [
    { face: 'surprised', look: '#bell', play: 'notify' },
    { face: 'happy', hold: 0.6 },
  ],
  success: [
    { face: 'excited', play: 'celebrate' },
    { face: 'happy', hold: 0.6 },
  ],
  error: [
    { face: 'sad', play: 'exclaim' },
    { face: 'neutral' },
  ],
  greeting: [
    { face: 'happy', play: 'wink' },
    { follow: 'pointer' },
  ],
  thinkingDone: [
    { status: 'thinking' },
    { face: 'curious', hold: 0.4 },
    { face: 'happy', hold: 0.6 },
  ],
};
const momentState = { playing: false, count: 0, cancelLabel: 'Stopped' };

function showMomentMessage(message, warning = false) {
  el.momentError.textContent = message;
  el.momentError.dataset.warning = String(warning);
  el.momentError.hidden = !message;
}
function clearMomentMessage() {
  el.momentError.textContent = '';
  el.momentError.hidden = true;
}
function setMomentStatus(text, playing = momentState.playing) {
  el.momentStatus.textContent = text;
  el.momentStatus.classList.toggle('is-playing', playing);
}
function prettyMoments(beats) {
  return JSON.stringify(beats, null, 2);
}
function missingLook(beats) {
  const check = (beat) => {
    if (typeof beat?.look === 'string' && beat.look && !document.querySelector(beat.look)) {
      return beat.look;
    }
    return null;
  };
  for (const beat of beats) {
    const direct = check(beat);
    if (direct) return direct;
    if (beat?.cue) {
      for (const cue of Array.isArray(beat.cue) ? beat.cue : [beat.cue]) {
        const found = check(cue);
        if (found) return found;
      }
    }
  }
  return null;
}
function stopMoment(label = 'Stopped') {
  if (!momentState.playing) return;
  momentState.cancelLabel = label;
  stageBlub.stop();
}
function interruptMoment() {
  stopMoment('Interrupted');
}
function prepareMoments(beats) {
  ensurePlaying();
  clearMove();
  momentState.count = beats.length;
  clearMomentMessage();
  const absent = missingLook(beats);
  if (absent) showMomentMessage(`Look target not found: ${absent}. That look will be skipped.`, true);
}
function playMoments(name, beats) {
  try {
    stageBlub.define(name, beats, { restore: 'all' });
  } catch (error) {
    showMomentMessage(error.message || String(error));
    return;
  }
  prepareMoments(beats);
  try {
    const running = stageBlub.run(name, {}, { restore: 'all' });
    running.catch((error) => showMomentMessage(error.message || String(error)));
  } catch (error) {
    showMomentMessage(error.message || String(error));
  }
}
function playJSON() {
  let beats;
  try {
    beats = JSON.parse(el.momentJson.value);
  } catch (error) {
    showMomentMessage(`Bad JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(beats)) {
    showMomentMessage('Your own moment must be a JSON array of beats.');
    return;
  }
  playMoments('custom', beats);
}
function buildMoments() {
  const saved = store.get('blubbles.moments.json');
  if (saved) el.momentJson.value = saved;
  for (const [name, beats] of Object.entries(MOMENT_PRESETS)) {
    stageBlub.define(name, beats, { restore: 'all' });
  }
  stageBlub.on('moment:start', () => {
    clearMove();
    momentState.playing = true;
    momentState.cancelLabel = 'Stopped';
    setMomentStatus('Starting', true);
    el.momentStop.disabled = false;
  });
  stageBlub.on('moment:beat', (event) => {
    setMomentStatus(`Beat ${event.index + 1} of ${momentState.count}`, true);
  });
  stageBlub.on('moment:end', (event) => {
    momentState.playing = false;
    el.momentStop.disabled = true;
    const label = event.status === 'completed' ? 'Done' : event.status === 'interrupted' ? 'Interrupted' : momentState.cancelLabel;
    momentState.cancelLabel = 'Stopped';
    setMomentStatus(label, false);
  });
  el.momentPresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-moment]');
    if (!button) return;
    const beats = MOMENT_PRESETS[button.dataset.moment];
    if (!beats) return;
    el.momentJson.value = prettyMoments(beats);
    store.set('blubbles.moments.json', el.momentJson.value);
    playMoments(button.dataset.moment, beats);
  });
  el.momentPlay.addEventListener('click', playJSON);
  el.momentStop.addEventListener('click', () => stopMoment('Stopped'));
  el.momentJson.addEventListener('input', () => store.set('blubbles.moments.json', el.momentJson.value));
  el.momentJson.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      playJSON();
    }
  });
  if (!el.momentJson.value.trim()) el.momentJson.value = MOMENT_DEFAULT;
}

/* bell */
const BELL_KEY = 'blubbles.bell';
const BELL_DEFAULT = { x: 0.72, y: 0.3 };
let bellPos = { ...BELL_DEFAULT };
let bellDrag = null;

function clampBell(x, y) {
  return { x: clamp(x, 0.02, 0.98), y: clamp(y, 0.03, 0.97) };
}
function placeBell(x, y, persist = true) {
  const rect = el.stage.getBoundingClientRect();
  const half = (el.bell.offsetWidth || 44) / 2;
  const px = clamp(x * rect.width, half + 8, Math.max(half + 8, rect.width - half - 8));
  const py = clamp(y * rect.height, half + 8, Math.max(half + 8, rect.height - half - 8));
  bellPos = clampBell(px / rect.width, py / rect.height);
  el.bell.style.left = `${px}px`;
  el.bell.style.top = `${py}px`;
  if (persist) store.set(BELL_KEY, JSON.stringify(bellPos));
}
function loadBell() {
  try {
    const saved = JSON.parse(store.get(BELL_KEY) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampBell(saved.x, saved.y);
  } catch {}
  return { ...BELL_DEFAULT };
}
function applyBell(pos) {
  placeBell(pos.x, pos.y, false);
}
function moveBellBy(clientX, clientY) {
  const rect = el.stage.getBoundingClientRect();
  placeBell((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
}
function buildBell() {
  applyBell(loadBell());
  el.bell.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = el.bell.getBoundingClientRect();
    bellDrag = {
      pointerId: event.pointerId,
      dx: event.clientX - (rect.left + rect.width / 2),
      dy: event.clientY - (rect.top + rect.height / 2),
    };
    el.bell.setPointerCapture(event.pointerId);
  });
  el.bell.addEventListener('pointermove', (event) => {
    if (!bellDrag || event.pointerId !== bellDrag.pointerId) return;
    moveBellBy(event.clientX - bellDrag.dx, event.clientY - bellDrag.dy);
  });
  const endDrag = (event) => {
    if (!bellDrag || event.pointerId !== bellDrag.pointerId) return;
    try { el.bell.releasePointerCapture(event.pointerId); } catch {}
    bellDrag = null;
  };
  el.bell.addEventListener('pointerup', endDrag);
  el.bell.addEventListener('pointercancel', endDrag);
  el.bell.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 24 : 8;
    const rect = el.stage.getBoundingClientRect();
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    placeBell((parseFloat(el.bell.style.left) + dx) / rect.width, (parseFloat(el.bell.style.top) + dy) / rect.height);
  });
  window.addEventListener('resize', () => placeBell(bellPos.x, bellPos.y, false));
}

/* toast */
let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2300);
}

/* boot */
buildGrids();
syncBg();
syncFollow();
syncPlay();
syncFinish();
syncSelection();
syncCaption();
syncExport();
setTab(state.tab);
refreshThumbs();
setTheme(document.documentElement.dataset.theme);
buildMoments();
buildBell();
