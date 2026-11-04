// Accessories: worn things drawn from the body's own outline and motion, not stickers.
// A hat finds where it fits on the head, a tie lies on the surface and turns with it,
// and everything soft follows the body through a spring response computed only from
// time, so the same instant always draws the same frame.
import { sampleRadiiAt } from '../geometry/silhouette.js';
import { TAU, clamp, easings, lerp, mixHex, r2 } from '../math/index.js';
import type { AccessoryBlur, AccessoryPart, AccessorySample, Gaze, Silhouette } from '../types.js';

export type AccessoryId = 'hat' | 'tie' | 'bowtie' | 'mustache';
export type AccessorySlot = 'head' | 'neck' | 'lip';

export const ACCESSORIES: readonly { id: AccessoryId; slot: AccessorySlot }[] = [
  { id: 'hat', slot: 'head' },
  { id: 'tie', slot: 'neck' },
  { id: 'bowtie', slot: 'neck' },
  { id: 'mustache', slot: 'lip' },
];

export interface AccessoryWear {
  id: AccessoryId;
  /** Hex colour, or null to pick a tone that suits the body. */
  color: string | null;
}

/** The face at one instant, on the same surface and turn as the eyes. */
export interface FaceFrame {
  /** Midpoint between the eyes, in viewBox units. */
  x: number;
  y: number;
  /** The surface's across and down directions here, foreshortened by the turn. */
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  /** 1 when the face is fully showing, 0 when it has gone. */
  alpha: number;
}

/** The body at one instant, as much of it as something worn can feel. */
export interface AccessoryRig {
  sil: Silhouette;
  x: number;
  y: number;
  gaze: Gaze;
  /** Eye height, so a surprised face can lift the hat. */
  brow: number;
  /** The lowest the open eyes reach, in viewBox units; null when no eyes show. */
  eyeBottom?: number | null;
  /** Where the face is now, for things that move with it rather than behind it. */
  face?: FaceFrame | null;
  /** Shrinks a mustache where it has to share a short chest with a bow tie. Default 1. */
  lipFit?: number;
  alpha: number;
}

/** How far each motion channel has run ahead of the soft parts, and the settling. */
export interface AccessorySwing {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  size: number;
}

/** Front pieces are drawn at this size against the body. */
const WORN_FRONT = 1.3;
const CREAM = '#f6f0e4';
const INK = '#0a0a0c';

/**
 * Taps of a damped spring's impulse response, normalised to sum to 1. Convolving a
 * channel with them lags it, overshoots a little and settles, with no stored state.
 */
export const SPRING_TAPS: readonly { delay: number; weight: number }[] = (() => {
  const omega = 15;
  const decay = 7.2;
  const taps = Array.from({ length: 9 }, (_, i) => {
    const delay = 0.035 + i * 0.05;
    return { delay, weight: Math.exp(-decay * delay) * Math.sin(omega * delay + 0.55) };
  });
  const sum = taps.reduce((total, tap) => total + tap.weight, 0);
  return taps.map((tap) => ({ delay: tap.delay, weight: tap.weight / sum }));
})();

const luminanceOf = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

/** Below this, dark things disappear into the body. */
const DARK_BODY = 0.16;
const BLACK = '#000000';

/** Default tone: a deep version of the body colour, or cream on a very dark body. */
export function accessoryAutoColor(body: string): string {
  const n = Number.parseInt(body.slice(1), 16);
  if (luminanceOf(body) < DARK_BODY) return CREAM;
  // A gamma curve, not a mix towards black, so the tone stays rich rather than muddy.
  const deepen = (channel: number): number =>
    Math.round(255 * 0.5 * (channel / 255) ** 1.9 + 14);
  const hex = (channel: number): string => deepen(channel).toString(16).padStart(2, '0');
  return `#${hex((n >> 16) & 255)}${hex((n >> 8) & 255)}${hex(n & 255)}`;
}

/** Gradient stops for a clay-lit part: the body's light, gentler on a dark material. */
export function accessoryClayStops(base: string, highlight: number, shadow: number): string[] {
  return [
    mixHex(base, '#ffffff', 0.22 * highlight),
    mixHex(base, '#ffffff', 0.07 * highlight),
    base,
    mixHex(base, INK, 0.4 * shadow),
  ];
}

/** The colour a part paints with, once the body colour is known. */
export function accessoryPartColor(part: AccessoryPart, body: string): string {
  if (part.color === 'shadow') return INK;
  // A mustache is black by default, unless black would vanish into the body.
  if (part.color === 'lip') return luminanceOf(body) < DARK_BODY ? CREAM : BLACK;
  if (part.color === 'lip-line') return luminanceOf(body) < DARK_BODY ? INK : '#ffffff';
  const base = part.color === 'auto' ? accessoryAutoColor(body) : part.color;
  if (part.shade > 0) return mixHex(base, '#ffffff', part.shade);
  if (part.shade < 0) return mixHex(base, INK, -part.shade);
  return base;
}

type Map2 = (x: number, y: number) => [number, number];

const pt = (map: Map2, x: number, y: number): string => {
  const [px, py] = map(x, y);
  return `${r2(px)} ${r2(py)}`;
};

/** A small path pen that sends every coordinate through a mapping. */
class Pen {
  private d = '';
  constructor(private readonly map: Map2) {}
  M(x: number, y: number): this {
    this.d += `M${pt(this.map, x, y)}`;
    return this;
  }
  L(x: number, y: number): this {
    this.d += `L${pt(this.map, x, y)}`;
    return this;
  }
  C(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.d += `C${pt(this.map, a, b)} ${pt(this.map, c, d)} ${pt(this.map, e, f)}`;
    return this;
  }
  Z(): string {
    return `${this.d}Z`;
  }
  /** A smooth closed curve through points. */
  static loop(map: Map2, points: readonly (readonly [number, number])[]): string {
    const n = points.length;
    const at = (i: number): readonly [number, number] => points[(i + n) % n];
    const pen = new Pen(map).M(at(0)[0], at(0)[1]);
    for (let i = 0; i < n; i++) {
      const [bx, by] = at(i - 1);
      const [cx, cy] = at(i);
      const [dx, dy] = at(i + 1);
      const [ex, ey] = at(i + 2);
      pen.C(cx + (dx - bx) / 6, cy + (dy - by) / 6, dx - (ex - cx) / 6, dy - (ey - cy) / 6, dx, dy);
    }
    return pen.Z();
  }
}

const part = (
  d: string,
  color: AccessoryPart['color'],
  extra: Partial<Omit<AccessoryPart, 'd' | 'color'>> = {},
): AccessoryPart => ({ d, color, shade: 0, opacity: 1, clay: true, masked: false, ...extra });

const NUMBER = /-?\d+(?:\.\d+)?/g;

/** Reach of a gaussian blur worth keeping: past this it has faded to nothing. */
const BLUR_REACH = 3;

/** A blur sized to its path, so the filter never clips its edge or paints spare area. */
function blurOf(d: string, deviation: number): AccessoryBlur {
  const numbers = d.match(NUMBER)?.map(Number) ?? [0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }
  const reach = deviation * BLUR_REACH;
  return {
    deviation: r2(deviation),
    x: r2(minX - reach),
    y: r2(minY - reach),
    width: r2(maxX - minX + 2 * reach),
    height: r2(maxY - minY + 2 * reach),
  };
}

/** A shadow cast on the body: blurred for a real falloff, and clipped to the body after. */
const shadow = (d: string, opacity: number, deviation: number): AccessoryPart =>
  part(d, 'shadow', { opacity, clay: false, masked: true, blur: blurOf(d, deviation) });

/** World position of a point given in the body's scaled, unrotated frame. */
function bodyPoint(rig: AccessoryRig, angle: number, scale: number): [number, number] {
  const radius = sampleRadiiAt(rig.sil.radii, angle - rig.sil.rot);
  return [
    (radius * Math.cos(angle) * rig.sil.sx + rig.sil.cx + rig.x) * scale,
    (radius * Math.sin(angle) * rig.sil.sy + rig.sil.cy + rig.y) * scale,
  ];
}

/** The outline's upper edge at world x, or null when the body does not reach x. */
function topAt(rig: AccessoryRig, x: number, scale: number): number | null {
  let best: number | null = null;
  const steps = 48;
  let previous = bodyPoint(rig, Math.PI, scale);
  for (let i = 1; i <= steps; i++) {
    const current = bodyPoint(rig, Math.PI + (i / steps) * Math.PI, scale);
    const [ax, ay] = previous;
    const [bx, by] = current;
    if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) {
      const k = Math.abs(bx - ax) < 1e-6 ? 0 : (x - ax) / (bx - ax);
      const y = ay + (by - ay) * k;
      if (best === null || y < best) best = y;
    }
    previous = current;
  }
  return best;
}

/** The outline's lower edge at world x, for the same reason, falling back to the base. */
function bottomAt(rig: AccessoryRig, x: number, scale: number): number {
  let best: number | null = null;
  const steps = 48;
  let previous = bodyPoint(rig, 0, scale);
  for (let i = 1; i <= steps; i++) {
    const current = bodyPoint(rig, (i / steps) * Math.PI, scale);
    const [ax, ay] = previous;
    const [bx, by] = current;
    if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) {
      const k = Math.abs(bx - ax) < 1e-6 ? 0 : (x - ax) / (bx - ax);
      const y = ay + (by - ay) * k;
      if (best === null || y > best) best = y;
    }
    previous = current;
  }
  return best ?? bodyPoint(rig, Math.PI / 2, scale)[1];
}

/**
 * The lowest point of a set of eye cut-outs, from their paths and matrices. Call it with
 * eyes sampled open, so a blink does not make whatever avoids the eyes jump.
 */
export function eyesBottom(eyes: readonly { d: string; matrix: string }[]): number | null {
  let lowest: number | null = null;
  for (const eye of eyes) {
    const m = eye.matrix.match(NUMBER)?.map(Number);
    if (!m) continue;
    // Eye paths are rounded boxes: the end of every segment is enough to bound them.
    for (const segment of eye.d.match(/[MLA][^MLAZ]*/g) ?? []) {
      const numbers = segment.match(NUMBER)?.map(Number) ?? [];
      const px = numbers[numbers.length - 2];
      const py = numbers[numbers.length - 1];
      const y = m[1] * px + m[3] * py + m[5];
      if (lowest === null || y > lowest) lowest = y;
    }
  }
  return lowest;
}

/** Roughly how big the body is now: the mean radius, in body units. */
function bodySize(rig: AccessoryRig): number {
  let sum = 0;
  for (let i = 0; i < 16; i++) sum += sampleRadiiAt(rig.sil.radii, (i / 16) * TAU);
  return (sum / 16) * ((rig.sil.sx + rig.sil.sy) / 2);
}

const overshoot = (k: number): number => {
  const c = clamp(k);
  return 1 - Math.exp(-6.2 * c) * Math.cos(9.5 * c) * (1 - c * 0.2);
};

/** Wear progress: 0 is off, 1 is on, with a separate reading of the way it left. */
export interface AccessoryLife {
  /** Seconds since it was put on, large when settled. */
  on: number;
  /** Seconds since it was taken off, or null while worn. */
  off: number | null;
}

export const ACCESSORY_ON = 0.75;
export const ACCESSORY_OFF = 0.4;

function hat(
  rig: AccessoryRig,
  swing: AccessorySwing,
  life: AccessoryLife,
  scale: number,
  color: string | null,
): AccessoryPart[] {
  const size = clamp(bodySize(rig), 0.14, 1.1);
  const s = (size * scale) / 100;
  const brim = 53 * s;
  const crownH = 37 * s;
  const fit = brim * 0.76;
  const cx = (rig.sil.cx + rig.x) * scale + clamp(rig.gaze.yaw, -40, 40) * 0.14 * s;
  const left = topAt(rig, cx - fit, scale);
  const right = topAt(rig, cx + fit, scale);
  const crest = topAt(rig, cx, scale) ?? (rig.sil.cy + rig.y - size) * scale;
  const yL = left ?? crest + brim * 0.7;
  const yR = right ?? crest + brim * 0.7;
  // Seat where the head is wide enough, but always low enough to cover a pointed top.
  let seat = Math.min((yL + yR) / 2, crest + crownH * 0.78);
  seat = Math.max(seat, -121 + crownH + 4 * s);

  // Arrival: dropped from above, lands, the crown squashes and recovers.
  const inK = life.on / ACCESSORY_ON;
  const fall = 1 - easings.easeOutCubic(clamp(inK / 0.42));
  const bounce = inK < 1 ? Math.exp(-5 * inK) * Math.sin(inK * 15) : 0;
  const offK = life.off === null ? 0 : clamp(life.off / ACCESSORY_OFF);
  const lift = offK * offK;

  const brow = clamp((rig.brow - 0.41) * 34, -2, 12) * s;
  const dropY = -fall * 90 * s - lift * 62 * s - brow - swing.y * 0.6 * scale;
  const tilt =
    clamp(Math.atan2(yR - yL, 2 * fit), -0.42, 0.42) +
    rig.gaze.roll * 0.006 -
    0.085 +
    swing.yaw * 0.012 -
    swing.x * 1.4 +
    bounce * 0.1 +
    lift * 0.55;
  const squash = 1 - bounce * 0.26 + swing.y * 0.5 + swing.size * 0.35;
  // Worn, the crown stays in frame; only arriving and leaving may cross the edge.
  const worn = fall === 0 && lift === 0;
  const oy = worn ? Math.max(seat + dropY, -122 + crownH * squash) : seat + dropY;
  const ox = cx + swing.x * scale * 0.45 + lift * 24 * s;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const lean = clamp(swing.yaw * 0.32 + swing.x * 60, -9, 9) * s;
  const map: Map2 = (x, y) => {
    const up = -y / (crownH || 1);
    const lx = x + lean * clamp(up, 0, 1.2);
    const ly = y * (y < 0 ? squash : 1);
    return [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos];
  };
  // Looking up shows the underside of the brim's far edge; looking down hides it.
  const open = clamp(5.4 + rig.gaze.pitch * 0.11 + swing.pitch * 0.1, 2.2, 9) * s;
  const curl = (2.8 - swing.yaw * 0.06) * s;

  const brimPath = (spread = 0, dy = 0): string =>
    new Pen(map)
      .M(-brim - spread, dy - curl)
      .C(-brim * 0.62, dy - open * 1.25 - spread, brim * 0.62, dy - open * 1.25 - spread, brim + spread, dy - curl)
      .C(brim * 0.92 + spread, dy + open * 0.86 + spread, brim * 0.5, dy + open * 1.3 + spread, 0, dy + open * 1.3 + spread)
      .C(-brim * 0.5, dy + open * 1.3 + spread, -brim * 0.92 - spread, dy + open * 0.86 + spread, -brim - spread, dy - curl)
      .Z();
  const w0 = 33 * s;
  const w1 = 30 * s;
  const crown = (top: number, base: number, inset = 0): string =>
    new Pen(map)
      .M(-w0 + inset, base)
      .C(-w0 + inset - 0.6 * s, base * 0.4 + top * 0.6, -w1 + inset - 2 * s, top * 0.98, -w1 * 0.3, top + inset * 0.3)
      .C(-3 * s, top + 1.2 * s + inset * 0.3, 3 * s, top + 0.4 * s + inset * 0.3, w1 * 0.34, top + inset * 0.3)
      .C(w1 - inset + 2 * s, top * 0.98, w0 - inset + 0.6 * s, base * 0.4 + top * 0.6, w0 - inset, base)
      .C(w0 * 0.5, base + 5.2 * s, -w0 * 0.5, base + 5.2 * s, -w0 + inset, base)
      .Z();
  const band = (): string =>
    new Pen(map)
      .M(-w0 + 0.1 * s, -2 * s)
      .C(-w0 * 0.5, 3.6 * s, w0 * 0.5, 3.6 * s, w0 - 0.1 * s, -2 * s)
      .L(w0 - 0.2 * s, -10.5 * s)
      .C(w0 * 0.5, -5.2 * s, -w0 * 0.5, -5.2 * s, -w0 + 0.2 * s, -10.5 * s)
      .Z();
  const shine = new Pen(map)
    .M(-w1 * 0.72, -crownH * 0.56)
    .C(-w1 * 0.66, -crownH * 0.88, -w1 * 0.26, -crownH * 0.97, w1 * 0.06, -crownH * 0.94)
    .C(-w1 * 0.2, -crownH * 0.84, -w1 * 0.44, -crownH * 0.68, -w1 * 0.72, -crownH * 0.56)
    .Z();
  const c = color ?? 'auto';
  const onHead = clamp(1 - fall * 1.6) * (1 - lift);
  return [
    // Higher up, the hat's shadow spreads and softens; it sharpens as the hat lands.
    ...(onHead > 0 ? [shadow(brimPath(0.8 * s, 3.6 * s), 0.2 * onHead, (3 + fall * 6) * s)] : []),
    part(brimPath(), c, { shade: -0.12 }),
    part(new Pen(map)
      .M(-brim * 0.97, -curl * 0.7)
      .C(-brim * 0.62, -open * 1.25, brim * 0.62, -open * 1.25, brim * 0.97, -curl * 0.7)
      .C(brim * 0.62, -open * 0.28, -brim * 0.62, -open * 0.28, -brim * 0.97, -curl * 0.7)
      .Z(), c, { shade: -0.36, clay: false }),
    part(crown(-crownH, 0), c),
    part(band(), c, { shade: 0.34 }),
    part(new Pen(map)
      .M(-w0 + 0.1 * s, -2 * s)
      .C(-w0 * 0.5, 3.6 * s, w0 * 0.5, 3.6 * s, w0 - 0.1 * s, -2 * s)
      .L(w0 - 0.1 * s, -0.2 * s)
      .C(w0 * 0.5, 5.4 * s, -w0 * 0.5, 5.4 * s, -w0 + 0.1 * s, -0.2 * s)
      .Z(), 'shadow', { opacity: 0.32, clay: false }),
    part(shine, '#ffffff', { opacity: 0.17, clay: false }),
  ].map((p) => ({ ...p, opacity: p.opacity * rig.alpha * clamp(1 - fall * 1.2) * (1 - lift * lift) }));
}

interface SurfaceFrame {
  map: Map2;
  size: number;
  /** Foreshortening of the surface here: 1 facing us, near 0 at the edge. */
  face: number;
  /** How far down a hanging piece can run before it leaves the frame, in its units. */
  room: number;
}

/**
 * A frame lying on the front of the body, below the eyes. It turns with the gaze, more
 * slowly than the eyes, as a chest turns after a head, and is scaled to reach the outline.
 */
/** How a front piece wants to sit, and how far it reaches from its anchor. */
interface FrontFit {
  /** Preferred height on the body, 0 at the centre and 1 at the base. */
  drop: number;
  /** Reach above and below the anchor, in the piece's own units. */
  above: number;
  below: number;
  /** Size relative to other front pieces. Default 1. */
  size?: number;
  /** Hangs free past the body: straight down, with no surface falling away under it. */
  hangs?: boolean;
}

/** Clear air kept under the eyes and above the body's lower edge, in body units. */
const EYE_GAP = 5;
const BASE_GAP = 6;
/** A piece gives up size to fit, but stops before it becomes unreadable. */
const SMALLEST_FIT = 0.5;
/** How far a tie's blade runs from the knot, in viewBox units at full body scale. */
const TIE_LENGTH = 48;
/** Lowest a hanging piece reaches at rest, so a square export does not cut its tip. */
const FRAME_BOTTOM = 120;

function surface(
  rig: AccessoryRig,
  swing: AccessorySwing,
  fit: FrontFit,
  scale: number,
): SurfaceFrame {
  const size = clamp(bodySize(rig), 0.14, 1.1);
  // A squat body has less chest: the piece shrinks and sits lower.
  const roomy = clamp(sampleRadiiAt(rig.sil.radii, Math.PI / 2 - rig.sil.rot) * rig.sil.sy / (size * 0.9), 0.62, 1);
  const low = Math.min(fit.drop + (1 - roomy) * 0.55, 0.86);
  const yaw = ((rig.gaze.yaw - swing.yaw) * 0.33 * Math.PI) / 180;
  const pitch = ((rig.gaze.pitch - swing.pitch) * 0.2 * Math.PI) / 180;
  const roll = (rig.gaze.roll * 0.35 * Math.PI) / 180;
  const lat = Math.asin(low);
  const cy0 = Math.sin(lat - pitch);
  const cz0 = Math.cos(lat - pitch);
  const px = Math.sin(yaw) * cz0;
  const py = cy0;
  const pz = Math.cos(yaw) * cz0;
  const rx = px * Math.cos(roll) - py * Math.sin(roll);
  const ry = px * Math.sin(roll) + py * Math.cos(roll);
  const angle = Math.atan2(ry, rx);
  const reach = sampleRadiiAt(rig.sil.radii, angle - rig.sil.rot);
  const ax = (rx * reach * rig.sil.sx + rig.sil.cx + rig.x) * scale;
  const wanted = (ry * reach * rig.sil.sy + rig.sil.cy + rig.y) * scale;
  const fullSize = (size * scale * WORN_FRONT * (fit.size ?? 1) * lerp(0.72, 1, (roomy - 0.62) / 0.38)) / 100;

  // Measure the space between the eyes and the body's lower edge, then fit into it:
  // first by moving, and only when that is not enough, by getting smaller.
  const unit = scale / 100;
  const floor = bottomAt(rig, ax, scale) - BASE_GAP * unit * size;
  const ceiling = rig.eyeBottom == null ? -Infinity : rig.eyeBottom + EYE_GAP * unit * size;
  const tall = fit.above + fit.below;
  const s = Math.min(fullSize, Math.max(fullSize * SMALLEST_FIT, (floor - ceiling) / tall));
  const lowest = floor - fit.below * s;
  const highest = ceiling + fit.above * s;
  // The eyes win a tie: a piece may crowd the base, but never touches the face.
  const ay = Math.max(highest, Math.min(wanted, lowest));

  const ux = Math.cos(yaw) * Math.cos(roll);
  const uy = Math.cos(yaw) * Math.sin(roll);
  const vx = -Math.sin(roll) * cz0 * Math.max(0.5, Math.cos(yaw));
  const vy = Math.cos(roll) * cz0;
  // On the surface, lower points compress as it falls away, up to this share.
  const fallOf = (y: number): number =>
    y > 0 && !fit.hangs ? y * (1 - clamp(y / (150 * s), 0, 0.3)) : y;
  return {
    size: s,
    face: Math.max(0, pz),
    room: Math.max(0, (FRAME_BOTTOM * unit - ay) / (s * (vy || 1))),
    map: (x, y) => {
      // Rows bow with the sphere.
      const fall = fallOf(y);
      const bow = (-x * x * 0.0024 * (low + 0.25)) / (s || 1);
      return [
        ax + ux * x * s + vx * fall * s,
        ay + uy * x * s + vy * fall * s + bow * s,
      ];
    },
  };
}

function tie(
  rig: AccessoryRig,
  swing: AccessorySwing,
  life: AccessoryLife,
  scale: number,
  color: string | null,
): AccessoryPart[] {
  const body = surface(rig, swing, { drop: 0.66, above: 5, below: 8, hangs: true }, scale);
  const c = color ?? 'auto';
  const inK = clamp(life.on / ACCESSORY_ON);
  const offK = life.off === null ? 0 : clamp(life.off / ACCESSORY_OFF);
  // Arrival: the knot pops on, then the blade unrolls down the body with a little bounce.
  const knotIn = overshoot(inK * 2.4) * (1 - offK);
  const unroll = clamp(overshoot(clamp((inK - 0.12) * 1.4)) * (1 - easings.easeOutCubic(offK * 1.5)), 0, 1.12);
  const k = knotIn;
  // Free below the body, the blade swings wider than the eyes turn.
  const sway = clamp(swing.yaw * 1.1 + swing.x * 380, -24, 24);
  // Long and narrow: it hangs from the knot, off the body if the body ends first.
  // The same length in the world on most bodies, scaled back only on a small one.
  const full = clamp(TIE_LENGTH / Math.max(body.size, 0.7), 18, Math.max(18, body.room - 5));
  const slim = clamp(full / 50, 0.72, 1);
  // Stretching with a hop or an unroll's overshoot must not push the tip out of frame.
  const length = Math.min(full * unroll * (1 + clamp(swing.y * 2, -0.12, 0.12)), Math.max(full, body.room - 5));
  const widthAt = (u: number): number =>
    lerp(3.2, 8.8, Math.min(1, u / 0.82) ** 0.9) * slim * clamp(unroll * 1.5);
  const centre = (u: number): [number, number] => [sway * u * u, 4.4 + length * u];
  const edge = (u: number, side: number, inset = 0): [number, number] => {
    const [x, y] = centre(u);
    return [x + side * Math.max(0.2, widthAt(u) - inset), y];
  };
  const tip = centre(1);
  const blade = (spread = 0, dy = 0): string => {
    const mapped: Map2 = (x, y) => body.map(x, y + dy);
    const pen = new Pen(mapped);
    const a = edge(0, -1);
    const b = edge(0.82, -1);
    const e = edge(0.82, 1);
    const f = edge(0, 1);
    const midL = edge(0.42, -1);
    const midR = edge(0.42, 1);
    pen
      .M(a[0] - spread, a[1])
      .C(midL[0] - spread, midL[1] - 4, midL[0] - spread, midL[1] + 4, b[0] - spread, b[1])
      .C(b[0] + 1 - spread, b[1] + 2, tip[0] - 1.4, tip[1] - 1.2 + spread, tip[0], tip[1] + spread)
      .C(tip[0] + 1.4, tip[1] - 1.2 + spread, e[0] - 1 + spread, e[1] + 2, e[0] + spread, e[1])
      .C(midR[0] + spread, midR[1] + 4, midR[0] + spread, midR[1] - 4, f[0] + spread, f[1]);
    return pen.Z();
  };
  const stripe = (u: number): string => {
    const a = 0.028;
    const ll = edge(u + 0.04, -1);
    const lh = edge(u + 0.04 + a, -1);
    const rl = edge(u - 0.04, 1);
    const rh = edge(u - 0.04 + a, 1);
    return new Pen(body.map).M(ll[0], ll[1]).L(rl[0], rl[1]).L(rh[0], rh[1]).L(lh[0], lh[1]).Z();
  };
  const knot = (spread = 0, dy = 0): string => {
    const map: Map2 = (x, y) => body.map(x * k, (y + dy) * k);
    return Pen.loop(map, [
      [-5.6 - spread, -3.4 - spread],
      [0, -4 - spread],
      [5.6 + spread, -3.4 - spread],
      [3.2 + spread, 4.4 + spread],
      [0, 5.2 + spread],
      [-3.2 - spread, 4.4 + spread],
    ]);
  };
  const visible = unroll > 0.01;
  const a = rig.alpha * clamp(k * 3) * clamp((bodySize(rig) - 0.26) / 0.2);
  const parts: AccessoryPart[] = [
    ...(visible ? [shadow(blade(0.4, 2), 0.2, 1.6)] : []),
    ...(visible
      ? [
          part(blade(), c),
          part(stripe(0.2), c, { shade: 0.3, clay: false, opacity: 0.85 }),
          part(stripe(0.4), c, { shade: 0.3, clay: false, opacity: 0.85 }),
          part(stripe(0.6), c, { shade: 0.3, clay: false, opacity: 0.85 }),
        ]
      : []),
    shadow(knot(0.4, 2.4), 0.2, 1.1),
    part(knot(), c, { shade: -0.1 }),
    part(new Pen((x, y) => body.map(x * k, y * k))
      .M(-4, -3)
      .C(-1.8, -3.9, 1.8, -3.9, 4, -3)
      .C(2, -2.1, -2, -2.1, -4, -3)
      .Z(), '#ffffff', { opacity: 0.2, clay: false }),
  ];
  return parts.map((p) => ({ ...p, opacity: p.opacity * a }));
}

function bowtie(
  rig: AccessoryRig,
  swing: AccessorySwing,
  life: AccessoryLife,
  scale: number,
  color: string | null,
): AccessoryPart[] {
  const body = surface(rig, swing, { drop: 0.56, above: 17.5, below: 16, size: 0.8 }, scale);
  const c = color ?? 'auto';
  const inK = clamp(life.on / ACCESSORY_ON);
  const offK = life.off === null ? 0 : clamp(life.off / ACCESSORY_OFF);
  // Arrival: the knot appears, then the wings spring open from it, cloth with some give.
  const open = overshoot(clamp((inK - 0.08) * 1.15)) * (1 - easings.easeInOutCubic(offK));
  const knotK = overshoot(inK * 2.8) * (1 - offK);
  const flapL = clamp(-swing.yaw * 0.5 - swing.pitch * 0.5 + swing.y * 60, -9, 9);
  const flapR = clamp(swing.yaw * 0.5 - swing.pitch * 0.5 + swing.y * 60, -9, 9);
  const stretchL = 1 + clamp(-swing.yaw * 0.012 - swing.x * 2, -0.14, 0.14);
  const stretchR = 1 + clamp(swing.yaw * 0.012 + swing.x * 2, -0.14, 0.14);

  const wing = (side: number, flap: number, stretch: number, spread = 0, dy = 0): string => {
    const reach = 35 * open * stretch + spread;
    const map: Map2 = (x, y) => body.map(side * x, y + dy + (flap * x) / 35);
    return new Pen(map)
      .M(3.5, -4.5 - spread * 0.4)
      .C(reach * 0.34, -8 - spread * 0.6, reach * 0.62, -17.5 - spread, reach * 0.84, -16 - spread)
      .C(reach * 1.03, -14.6 - spread, reach * 1.03, -6.5, reach * 0.97, 1.5)
      .C(reach * 0.99, 8, reach * 0.98, 14, reach * 0.8, 15.2 + spread)
      .C(reach * 0.58, 16 + spread, reach * 0.34, 7.5 + spread * 0.6, 3.5, 4.5 + spread * 0.4)
      .Z();
  };
  const crease = (side: number, flap: number, stretch: number, dy: number, bend: number): string => {
    const reach = 35 * open * stretch;
    const map: Map2 = (x, y) => body.map(side * x, y + (flap * x) / 35);
    return new Pen(map)
      .M(5, dy * 0.22 - 0.5)
      .C(reach * 0.32, dy * 0.42 - 0.8, reach * 0.54, dy * 0.8 - bend, reach * 0.74, dy - 0.2)
      .C(reach * 0.54, dy * 0.8 - bend + 1.8, reach * 0.32, dy * 0.42 + 0.9, 5, dy * 0.22 + 0.5)
      .Z();
  };
  const knot = (spread = 0, dy = 0): string => {
    const map: Map2 = (x, y) => body.map(x * knotK, (y + dy) * knotK);
    return Pen.loop(map, [
      [-6 - spread, -5.5 - spread],
      [0, -6.6 - spread],
      [6 + spread, -5.5 - spread],
      [6.8 + spread, 0],
      [5.6 + spread, 6 + spread],
      [0, 7 + spread],
      [-5.6 - spread, 6 + spread],
      [-6.8 - spread, 0],
    ]);
  };
  const a = rig.alpha * clamp(knotK * 3) * clamp((bodySize(rig) - 0.26) / 0.2);
  const parts: AccessoryPart[] = [
    ...(open > 0
      ? [shadow(wing(-1, flapL, stretchL, 0.5, 2.4) + wing(1, flapR, stretchR, 0.5, 2.4), 0.2 * clamp(open), 1.9)]
      : []),
    part(wing(-1, flapL, stretchL), c),
    part(wing(1, flapR, stretchR), c),
    part(crease(-1, flapL, stretchL, -8.5, 1.5), 'shadow', { opacity: 0.2, clay: false }),
    part(crease(-1, flapL, stretchL, 7.5, -1.5), 'shadow', { opacity: 0.2, clay: false }),
    part(crease(1, flapR, stretchR, -8.5, 1.5), 'shadow', { opacity: 0.2, clay: false }),
    part(crease(1, flapR, stretchR, 7.5, -1.5), 'shadow', { opacity: 0.2, clay: false }),
    part(new Pen((x, y) => body.map(x, y + (flapL * -x) / 35))
      .M(-13 * open, -7)
      .C(-20 * open, -11.5, -27 * open, -13, -30 * open, -11.5)
      .C(-26 * open, -9.4, -19 * open, -7.2, -13 * open, -7)
      .Z(), '#ffffff', { opacity: 0.2, clay: false }),
    shadow(knot(0.5, 1.8), 0.18, 1),
    part(knot(), c, { shade: 0.12 }),
    part(new Pen((x, y) => body.map(x * knotK, y * knotK))
      .M(-3.8, -3.5)
      .C(-1.6, -4.5, 1.6, -4.5, 3.8, -3.5)
      .C(1.8, -2.4, -1.8, -2.4, -3.8, -3.5)
      .Z(), '#ffffff', { opacity: 0.22, clay: false }),
  ];
  return parts.map((p) => ({ ...p, opacity: p.opacity * a }));
}

/** How far a mustache reaches from its centre line, up and down, in its own units. */
const MUSTACHE_ABOVE = 6;
const MUSTACHE_BELOW = 7.5;

/** Size of a mustache on this body: its units per viewBox unit. */
const mustacheSize = (rig: AccessoryRig, scale: number): number =>
  (clamp(bodySize(rig), 0.14, 1.1) * scale * 1.416 * (rig.lipFit ?? 1)) / 100;

/** The most of a short chest a mustache may take when a bow tie needs the rest. */
const LIP_SHARE = 0.55;

/**
 * How small a mustache gets to leave a bow tie room, 1 on any body with space for both.
 * `bow` is how far the bow tie has arrived, so the mustache gives way as it does.
 */
export function mustacheFitFor(rig: AccessoryRig, bow: number, scale: number): number {
  if (rig.eyeBottom == null) return 1;
  const unit = scale / 100;
  const size = clamp(bodySize(rig), 0.14, 1.1);
  const floor = bottomAt(rig, rig.face?.x ?? (rig.sil.cx + rig.x) * scale, scale) - BASE_GAP * unit * size;
  const wants = mustacheSpace({ ...rig, lipFit: 1 }, { on: ACCESSORY_ON, off: null }, scale);
  const fit = clamp(((floor - rig.eyeBottom) * LIP_SHARE) / (wants || 1), 0.6, 1);
  return lerp(1, fit, bow);
}

/** How much of the eyes' clearance a worn mustache takes up, so neck pieces sit below it. */
export function mustacheSpace(rig: AccessoryRig, life: AccessoryLife, scale: number): number {
  const off = life.off === null ? 0 : clamp(life.off / ACCESSORY_OFF);
  const k = easings.easeOutCubic(clamp(life.on / ACCESSORY_ON)) * (1 - off);
  const above = Math.max(MUSTACHE_ABOVE, 2.6 + 4.2 + clamp((rig.brow - 0.41) * 12, -1.4, 3));
  return k * (EYE_GAP * 0.7 + above + MUSTACHE_BELOW) * mustacheSize(rig, scale);
}

function mustache(
  rig: AccessoryRig,
  swing: AccessorySwing,
  life: AccessoryLife,
  scale: number,
  color: string | null,
): AccessoryPart[] {
  const face = rig.face;
  if (!face || rig.eyeBottom == null) return [];
  const s = mustacheSize(rig, scale);
  const c = color ?? 'lip';
  // Black stays truly black, so it takes no light; its form comes from the hair lines.
  const pure = color === null || color === BLACK;
  const line = color === null ? 'lip-line' : luminanceOf(color) < 0.2 ? '#ffffff' : 'shadow';
  const inK = clamp(life.on / ACCESSORY_ON);
  const offK = life.off === null ? 0 : clamp(life.off / ACCESSORY_OFF);
  // Arrival: it spreads out from under the eyes, and the tips flick up last.
  const grow = overshoot(inK * 1.5) * (1 - easings.easeInOutCubic(offK));
  const flick = Math.exp(-5 * inK) * Math.sin(clamp((inK - 0.3) / 0.7) * 16) * 4;
  // Now and then it twitches, the way a mustache does. Only time drives it.
  const beat = life.on * 0.83;
  const twitch = Math.max(0, Math.sin(beat)) ** 60 * Math.sin(beat * 26) * 1.5;
  const reach = 31 * grow;

  // The body settles after a move: the tips follow late, the centre stays with the face.
  const restLift = 4.2 + clamp((rig.brow - 0.41) * 12, -1.4, 3);
  const lift = restLift + flick + twitch + clamp(swing.y * 90, -4, 4);
  const flapL = clamp(-swing.yaw * 0.4 - swing.pitch * 0.3, -5, 5);
  const flapR = clamp(swing.yaw * 0.4 - swing.pitch * 0.3, -5, 5);

  // Rests under the eyes, along the face's own down direction, so it turns with them.
  // It sits low enough to clear its own raised tips.
  const y0 = rig.eyeBottom + (EYE_GAP * 0.7 + Math.max(MUSTACHE_ABOVE, 2.6 + restLift)) * s;
  const x0 = face.x + (face.cy > 0.05 ? ((y0 - face.y) * face.cx) / face.cy : 0);
  const mapSide = (side: number, flap: number, dy = 0): Map2 => (x, y) => {
    const t = clamp(x / 31);
    const ly = y + dy + flap * t * t + 1.8 * t * t;
    const lx = side * x;
    return [
      x0 + (face.ax * lx + face.cx * ly) * s,
      y0 + (face.ay * lx + face.cy * ly) * s,
    ];
  };
  const lobe = (side: number, flap: number, spread = 0, dy = 0): string => {
    const r = reach + spread;
    const pen = new Pen(mapSide(side, flap, dy));
    return pen
      .M(0.2, -3.2 - spread)
      .C(r * 0.16, -6.4 - spread, r * 0.42, -6 - spread, r * 0.62, -2.6 - spread)
      .C(r * 0.74, -0.6, r * 0.86, -0.8 - lift * 0.4, r, -2.6 - lift)
      .C(r * 1.03, -0.4 - lift * 0.3, r * 0.94, 2.6, r * 0.76, 3.6 + spread)
      .C(r * 0.52, 5.8 + spread, r * 0.22, 7.6 + spread, 0.2, 5 + spread)
      .Z();
  };
  const strand = (side: number, flap: number, from: number, to: number, y: number, bend: number): string => {
    const pen = new Pen(mapSide(side, flap));
    return pen
      .M(reach * from, y)
      .C(reach * (from + (to - from) * 0.4), y - bend, reach * (from + (to - from) * 0.75), y - bend, reach * to, y + 0.4)
      .C(reach * (from + (to - from) * 0.75), y - bend + 0.9, reach * (from + (to - from) * 0.4), y - bend + 0.9, reach * from, y + 0.7)
      .Z();
  };
  const sheen = new Pen(mapSide(-1, flapL))
    .M(reach * 0.14, -4.4)
    .C(reach * 0.3, -6, reach * 0.46, -5.2, reach * 0.58, -3)
    .C(reach * 0.44, -3.9, reach * 0.28, -4.2, reach * 0.14, -4.4)
    .Z();
  const a = rig.alpha * face.alpha * clamp(grow * 3) * clamp((bodySize(rig) - 0.26) / 0.2);
  const parts: AccessoryPart[] = [
    shadow(lobe(-1, flapL, 0.3, 1.8) + lobe(1, flapR, 0.3, 1.8), 0.18, 1.3 * s),
    part(lobe(-1, flapL), c, { masked: true, clay: !pure }),
    part(lobe(1, flapR), c, { masked: true, clay: !pure }),
    ...[-1, 1].flatMap((side) => {
      const flap = side < 0 ? flapL : flapR;
      return [
        part(strand(side, flap, 0.1, 0.6, 1.4, 0.7), line, { masked: true, opacity: 0.2, clay: false }),
        part(strand(side, flap, 0.16, 0.72, 3.8, 0.9), line, { masked: true, opacity: 0.16, clay: false }),
      ];
    }),
    part(sheen, '#ffffff', { masked: true, opacity: 0.16, clay: false }),
  ];
  return parts.map((p) => ({ ...p, opacity: p.opacity * a }));
}

const DRAW = { hat, tie, bowtie, mustache } as const;

export function sampleAccessory(
  id: AccessoryId,
  rig: AccessoryRig,
  swing: AccessorySwing,
  life: AccessoryLife,
  scale: number,
  color: string | null,
): AccessorySample {
  return { id, parts: DRAW[id](rig, swing, life, scale, color).filter((p) => p.opacity > 0.002) };
}
