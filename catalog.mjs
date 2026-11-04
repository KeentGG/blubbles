// Shared catalog + URL-state helpers for the studio.
// The name maps live in src/names.ts so the browser library and the studio agree.
import { SHAPES as ENGINE_SHAPES, COLORS as ENGINE_COLORS, EXPRESSIONS, STATES } from './dist/engine/index.js';
import {
  SHAPE_LABEL, COLOR_LABEL, FACE_LABEL, MOVE_LABEL,
} from './dist/names.js';
import { colorHex, shapeId, faceId, colorId } from './dist/resolve.js';

export {
  SHAPE_LABEL, COLOR_LABEL, FACE_LABEL, MOVE_LABEL,
  colorHex, shapeId, faceId, colorId,
};


export const DEFAULTS = {
  shape: 'circle',
  face: 'neutral',
  color: 'blue',
  finish: 'clay',
};

const HEX = /^[0-9a-f]{6}$/i;
export const wearOptions = [
  { id: 'hat', label: 'Hat', slot: 'head' },
  { id: 'tie', label: 'Tie', slot: 'neck' },
  { id: 'bowtie', label: 'Bow tie', slot: 'neck' },
  { id: 'mustache', label: 'Mustache', slot: 'lip' },
];

/** Keeps known names, at most one per slot, from "hat,tie" or an array. */
export function parseWear(raw) {
  const names = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const bySlot = new Map();
  for (const name of names) {
    const option = wearOptions.find((o) => o.id === name);
    if (option) bySlot.set(option.slot, option.id);
  }
  return [...bySlot.values()];
}

const slotOf = (id) => wearOptions.find((o) => o.id === id)?.slot;
const parseHex = (raw) => (HEX.test(raw ?? '') ? `#${raw.toLowerCase()}` : null);

/** Colours per slot, from "hat:c8324a,mustache:6b4226". */
function parseTones(raw) {
  const tones = {};
  for (const entry of String(raw ?? '').split(',')) {
    const [id, hex] = entry.split(':');
    const slot = slotOf(id);
    const value = parseHex(hex);
    if (slot && value) tones[slot] = value;
  }
  return tones;
}

/**
 * The worn list with each item's colour. A shared colour covers everything except a
 * mustache, which always keeps its own. Null means the item's default.
 */
export function wearColors({ wear = [], unify = false, tone = null, tones = {} }) {
  return wear.map((id) => {
    const slot = slotOf(id);
    return { id, color: (unify && slot !== 'lip' ? tone : tones[slot]) ?? null };
  });
}

export function parseConfig(search = '') {
  const q = new URLSearchParams(search);
  const shape = shapeId(q.get('shape')) ?? DEFAULTS.shape;
  const face = faceId(q.get('face')) ?? DEFAULTS.face;
  const raw = q.get('color') ?? '';
  let color = DEFAULTS.color;
  if (/^#[0-9a-f]{6}$/i.test(raw)) color = raw.toLowerCase();
  else if (HEX.test(raw)) color = `#${raw.toLowerCase()}`;
  else color = colorId(raw) ?? DEFAULTS.color;
  return {
    shape,
    face,
    color,
    finish: q.get('finish') === 'flat' ? 'flat' : 'clay',
    wear: parseWear(q.get('wear')),
    // "tone" is the shared colour: a hex, or "auto" for shared with no colour picked.
    unify: q.get('tone') === 'auto' || parseHex(q.get('tone')) !== null,
    tone: parseHex(q.get('tone')),
    tones: parseTones(q.get('tones')),
  };
}

export function configQuery({ shape, face, color, finish, wear = [], unify = false, tone = null, tones = {} }) {
  const p = new URLSearchParams();
  if (shape !== DEFAULTS.shape) p.set('shape', shape);
  if (face !== DEFAULTS.face) p.set('face', face);
  if (color !== DEFAULTS.color) p.set('color', color.startsWith('#') ? color.slice(1) : color);
  if (finish === 'flat') p.set('finish', 'flat');
  if (wear.length) p.set('wear', wear.join(','));
  if (wear.length && unify) p.set('tone', tone ? tone.slice(1) : 'auto');
  const own = wearColors({ wear, unify, tone, tones })
    .filter(({ id, color: hex }) => hex && (!unify || slotOf(id) === 'lip'))
    .map(({ id, color: hex }) => `${id}:${hex.slice(1)}`);
  if (own.length) p.set('tones', own.join(','));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const shapeOptions = ENGINE_SHAPES.map((s) => ({
  id: s.id,
  label: SHAPE_LABEL[s.id],
  radii: s.radii,
}));
export const colorOptions = ENGINE_COLORS.map((c) => ({
  id: c.id,
  label: COLOR_LABEL[c.id],
  hex: c.hex,
}));
export const faceOptions = EXPRESSIONS.map((e) => ({
  id: e.id,
  label: FACE_LABEL[e.id],
}));
export const moveOptions = STATES.map((s) => ({
  id: s.id,
  label: MOVE_LABEL[s.id] ?? s.id,
  morph: s.morph,
  duration: s.minDuration ?? s.duration,
}));

export const durationOf = (id) => {
  const maxMorph = Math.max(...STATES.map((s) => s.morph));
  const st = STATES.find((s) => s.id === id);
  return Math.max(maxMorph, st?.minDuration ?? st?.duration ?? 2);
};

export function randomConfig() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shapes = ENGINE_SHAPES.map((s) => s.id);
  const colors = ENGINE_COLORS.map((c) => c.id).filter((c) => c !== 'ink' && c !== 'cream');
  const faces = EXPRESSIONS.map((e) => e.id);
  return { shape: pick(shapes), face: pick(faces), color: pick(colors) };
}
