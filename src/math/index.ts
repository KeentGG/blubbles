// Scalar maths shared by every module: constants, easing, noise, seeded RNG,
// colour helpers and the two-decimal rounding used by every path string.
export const TAU = 2 * Math.PI;

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export const easings = {
  easeOutCubic: (t: number): number => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeOutQuint: (t: number): number => 1 - (1 - t) ** 5,
};

/** Three out-of-phase sines: the ambient wander that never repeats exactly. */
export function loopNoise(t: number, period: number, phase = 0): number {
  const angle = (t / period) * TAU;
  return (
    0.55 * Math.sin(angle + phase) +
    0.3 * Math.sin(2 * angle + 1.7 * phase + 1.1) +
    0.15 * Math.sin(3 * angle + 2.3 * phase + 2.4)
  );
}

export type Rng = () => number;

/** mulberry32. Same seed, same sequence, on every platform. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    let t = Math.imul((state = (state + 0x6d2b79f5) >>> 0) ^ (state >>> 15), 1 | state);
    return (
      (((t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) ^ (t >>> 14)) >>> 0) /
      0x100000000
    );
  };
}

/** Round to two decimals. Every SVG coordinate in the engine goes through it. */
export function r2(value: number): number {
  return Math.round(100 * value) / 100;
}

/** HSL (degrees, 0..1, 0..1) to `#rrggbb`, used by the arc gradients. */
export function hsl(hue: number, saturation = 0.55, lightness = 0.62): string {
  const h = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const [red, green, blue] =
    h < 60
      ? [chroma, second, 0]
      : h < 120
        ? [second, chroma, 0]
        : h < 180
          ? [0, chroma, second]
          : h < 240
            ? [0, second, chroma]
            : h < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const channel = (value: number): string =>
    Math.round((value + offset) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** Linear mix of two `#rrggbb` colours. */
export function mixHex(from: string, to: string, k: number): string {
  const parse = (hex: string): number[] => {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = parse(from);
  const b = parse(to);
  const mixed = a.map((value, i) => Math.round(value + (b[i] - value) * k));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
