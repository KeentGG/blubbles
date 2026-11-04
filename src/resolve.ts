// One place for engine id / colour resolution. Shapes, faces and colours are
// English engine ids now; the pre-rename French ids stay as aliases.
import {
  COLORS,
  COLOR_BY_ID,
  EXPRESSIONS,
  EXPRESSION_BY_ID,
  SHAPES,
  SHAPE_BY_ID,
  STATE_BY_ID,
} from './engine/index.js';
import type { ExpressionId, ShapeId, StateId } from './types.js';

const LEGACY_SHAPE_IDS: Record<string, string> = {
  cercle: 'circle',
  galet: 'pebble',
  hexagone: 'hexagon',
  nuage: 'cloud',
  goutte: 'droplet',
};
const LEGACY_FACE_IDS: Record<string, string> = {
  neutre: 'neutral',
  attentif: 'attentive',
  surpris: 'surprised',
  excite: 'excited',
  heureux: 'happy',
  hilare: 'laughing',
  colere: 'angry',
  triste: 'sad',
  effraye: 'scared',
  mefiant: 'suspicious',
  confus: 'confused',
  curieux: 'curious',
  fier: 'proud',
  timide: 'shy',
  blase: 'unimpressed',
  somnolent: 'sleepy',
};
const LEGACY_COLOR_IDS: Record<string, string> = {
  encre: 'ink',
  creme: 'cream',
  brun: 'brown',
  rouge: 'red',
  ambre: 'amber',
  vert: 'green',
  bleu: 'blue',
  violet: 'purple',
  rose: 'pink',
  gris: 'grey',
};

const FALLBACK_COLOUR = '#3b93f0';
const COLOR_NAMES = Object.keys(COLORS);

export const quote = (value: unknown): string => JSON.stringify(String(value));
export const list = (values: readonly string[]): string => values.map(quote).join(', ');

/** Levenshtein distance, for "Did you mean" suggestions. */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

export function suggestion(value: unknown, values: readonly string[]): string {
  if (typeof value !== 'string' || !value) return '';
  const lower = value.toLowerCase();
  let best = '';
  let bestDistance = Infinity;
  for (const candidate of values) {
    const d = distance(lower, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  const allowed = Math.max(2, Math.floor(lower.length / 3));
  return bestDistance <= allowed ? ` Did you mean ${quote(best)}?` : '';
}

const PLURALS: Record<string, string> = { status: 'statuses', finish: 'finishes' };

export function unknown(kind: string, value: unknown, values: readonly string[]): TypeError {
  const plural = PLURALS[kind] ?? `${kind}s`;
  return new TypeError(
    `Unknown ${kind} ${quote(value)}.${suggestion(value, values)} Valid ${plural}: ${list(values)}.`,
  );
}

/** Resolve a shape id, legacy French id, or case variant to an engine id. */
export function shapeId(name: string | null | undefined): string | null {
  if (name == null) return null;
  const value = String(name).toLowerCase();
  if (SHAPE_BY_ID.has(value)) return value;
  return LEGACY_SHAPE_IDS[value] ?? null;
}

export function faceId(name: string | null | undefined): string | null {
  if (name == null) return null;
  const value = String(name).toLowerCase();
  if (EXPRESSION_BY_ID.has(value)) return value;
  return LEGACY_FACE_IDS[value] ?? null;
}

export function colorId(name: string | null | undefined): string | null {
  if (name == null) return null;
  const value = String(name).trim().toLowerCase();
  if (COLOR_BY_ID.has(value)) return value;
  return LEGACY_COLOR_IDS[value] ?? null;
}

/** Resolve a colour name/id, legacy id, or `#rrggbb` / `rrggbb` to a hex colour. */
export function colorHex(nameOrHex: string | null | undefined): string {
  if (nameOrHex == null) return FALLBACK_COLOUR;
  const value = String(nameOrHex).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
  const id = colorId(value);
  if (id) return COLOR_BY_ID.get(id)!.hex;
  return FALLBACK_COLOUR;
}

export function requireShape(value: unknown): ShapeId {
  if (typeof value === 'string') {
    const id = shapeId(value);
    if (id) return id as ShapeId;
  }
  throw unknown('shape', value, SHAPES.map((shape) => shape.id));
}

export function requireFace(value: unknown): ExpressionId {
  if (typeof value === 'string') {
    const id = faceId(value);
    if (id) return id as ExpressionId;
  }
  throw unknown('face', value, EXPRESSIONS.map((expression) => expression.id));
}

export function requireColor(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
    const id = colorId(trimmed);
    if (id) return id;
  }
  throw new TypeError(
    `Unknown colour ${quote(value)}.${suggestion(value, COLOR_NAMES)} Use ${list(COLOR_NAMES)} or a #rrggbb hex.`,
  );
}

/** Engine-level action/state id (idle, wink, egg, ...). */
export function requireAction(value: unknown): StateId {
  if (typeof value === 'string' && STATE_BY_ID.has(value)) return value as StateId;
  throw unknown('action', value, [...STATE_BY_ID.keys()]);
}
