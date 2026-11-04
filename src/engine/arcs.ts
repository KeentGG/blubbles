// Decoration data and the arc projector: seeded rings, swoosh and comet ribbons,
// burst particles, and the 3D-ish curve that turns a ribbon seed into two paths.
import { TAU, clamp, createRng, hsl, r2 } from '../math/index.js';
import type { ArcSeed, DotSpec, RenderedArc } from '../types.js';

const ringRng = createRng(659918);

export const RINGS: ArcSeed[] = Array.from({ length: 6 }, (_, i) => ({
  a: 1.3 + 0.1 * ringRng(),
  k: 0.05 + 0.4 * ringRng(),
  tilt: (i / 6) * Math.PI + 0.5 * ringRng(),
  speed: 3 + 0.7 * ringRng(),
  phase: ringRng() * TAU,
  sweep: 0.6 + 0.25 * ringRng(),
  hue: (360 * i) / 6 + 30 * ringRng(),
  hueSpan: 60 + 60 * ringRng(),
  width: 0.05 + 0.012 * ringRng(),
  cx: 0,
  cy: 0.1,
}));

export const SWOOSH: ArcSeed[] = Array.from({ length: 4 }, (_, i) => ({
  a: 0.78 + 0.2 * i,
  k: 0.05 + 0.02 * i,
  tilt: -0.62 + 0.05 * i,
  speed: 0.3,
  phase: 0.06 * i,
  sweep: 0.4,
  hue: 95 + 62 * i,
  hueSpan: 100,
  width: 0.05,
  cx: 0,
  cy: -0.12,
}));

// Internal: the comet pose uses these ribbons; they are not part of the public API.
const cometRng = createRng(49383);
export const COMET_RIBBONS: ArcSeed[] = Array.from({ length: 4 }, (_, i) => {
  const offset = i - 1.5;
  return {
    a: 0.85 * (1 + 0.03 * offset),
    k: (0.15 / 0.85) * (1 + 0.16 * offset),
    tilt: (34 * Math.PI) / 180 + 0.035 * offset,
    speed: 210 / 360,
    phase: -(0.045 * i) + 0.012 * cometRng(),
    sweep: 0.34,
    hue: 85 * i + 20 * cometRng(),
    hueSpan: 80,
    width: 0.095,
    cx: 0,
    cy: 0,
  };
});

const particleRng = createRng(48879);
const PARTICLES = Array.from({ length: 5 }, (_, i) => ({
  birth: 0.2 * i,
  angle: particleRng() * TAU,
  rho: 0.58 + 0.18 * particleRng(),
}));

/** Burst particles: five seeded dots that expand and fade over 0.62 s. */
export function particles(t: number, scale: number): DotSpec[] {
  const dots: DotSpec[] = [];
  for (const particle of PARTICLES) {
    const age = t - particle.birth;
    if (age < 0 || age > 0.62) continue;
    const rho = particle.rho * Math.pow(0.75, 10 * age);
    const angle = particle.angle + (100 * age * Math.PI) / 180;
    dots.push({
      x: Math.cos(angle) * rho * scale,
      y: Math.sin(angle) * rho * scale,
      r: (0.04 + 0.028 * clamp(age / 0.55)) * scale,
      depth: clamp(1 - rho / 0.8),
      opacity: clamp(age / 0.06) * clamp((0.62 - age) / 0.08),
    });
  }
  return dots;
}

/** Project one ribbon seed at time `t` into back/front strokes and a gradient. */
export function arcRender(
  seed: ArcSeed,
  t: number,
  scale: number,
  id: string,
  opacity = 1,
): RenderedArc {
  const start = seed.phase + t * seed.speed * TAU;
  const cosTilt = Math.cos(seed.tilt);
  const sinTilt = Math.sin(seed.tilt);
  const depthScale = Math.sqrt(Math.max(0, 1 - seed.k * seed.k));
  const sweep = seed.sweep * TAU;
  let front = '';
  let back = '';
  let wasBack: boolean | null = null;
  for (let i = 0; i <= 64; i++) {
    const angle = start + (i / 64) * sweep;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = seed.a * (cos * cosTilt + -(sin * sinTilt) * seed.k) + seed.cx;
    const y = seed.a * (cos * sinTilt + sin * cosTilt * seed.k) + seed.cy;
    const isBack = seed.a * sin * depthScale < 0;
    const px = r2(x * scale);
    const py = r2(y * scale);
    const command = isBack !== wasBack ? 'M' : 'L';
    if (isBack) back += `${command}${px} ${py}`;
    else front += `${command}${px} ${py}`;
    wasBack = isBack;
  }
  const gradX = Math.cos(seed.tilt) * seed.a * scale;
  const gradY = Math.sin(seed.tilt) * seed.a * scale;
  return {
    id,
    front,
    back,
    width: seed.width * scale,
    opacity,
    grad: {
      x1: r2(seed.cx * scale - gradX),
      y1: r2(seed.cy * scale - gradY),
      x2: r2(seed.cx * scale + gradX),
      y2: r2(seed.cy * scale + gradY),
      stops: [hsl(seed.hue), hsl(seed.hue + 0.5 * seed.hueSpan), hsl(seed.hue + seed.hueSpan)],
    },
  };
}
