// Clay intensity: how strongly the gradient highlight and shadow mix, and where
// the light sits. Public option type; the renderers read the normalised settings.
export interface ClayOptions {
  /** Highlight strength, 0..2. Default 1. */
  highlight?: number;
  /** Shadow strength, 0..2. Default 1. */
  shadow?: number;
  /** Light centre in unit body coordinates. Default { x: -0.32, y: -0.4 }. */
  light?: { x?: number; y?: number };
}

export interface ClaySettings {
  highlight: number;
  shadow: number;
  light: { x: number; y: number };
}

export const DEFAULT_CLAY: ClaySettings = {
  highlight: 1,
  shadow: 1,
  light: { x: -0.32, y: -0.4 },
};

function amount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`clay.${name} must be a finite number between 0 and 2.`);
  }
  return Math.max(0, Math.min(2, value));
}

/** Validate a patch without filling defaults, so `{ highlight }` stays partial. */
export function validateClayPatch(value: unknown): number | ClayOptions {
  if (typeof value === 'number') return amount(value, 'highlight');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('clay must be a number or an options object.');
  }
  const source = value as ClayOptions;
  const out: ClayOptions = {};
  if (source.highlight !== undefined) out.highlight = amount(source.highlight, 'highlight');
  if (source.shadow !== undefined) out.shadow = amount(source.shadow, 'shadow');
  if (source.light !== undefined) {
    if (source.light === null || typeof source.light !== 'object') {
      throw new TypeError('clay.light must be { x?, y? }.');
    }
    const light: { x?: number; y?: number } = {};
    if (source.light.x !== undefined) {
      if (typeof source.light.x !== 'number' || !Number.isFinite(source.light.x)) {
        throw new TypeError('clay.light.x must be a finite number.');
      }
      light.x = source.light.x;
    }
    if (source.light.y !== undefined) {
      if (typeof source.light.y !== 'number' || !Number.isFinite(source.light.y)) {
        throw new TypeError('clay.light.y must be a finite number.');
      }
      light.y = source.light.y;
    }
    out.light = light;
  }
  return out;
}

/** Normalise a number shorthand, a partial object, or undefined to full settings. */
export function normalizeClay(value?: number | ClayOptions | ClaySettings): ClaySettings {
  if (value === undefined) {
    return { highlight: 1, shadow: 1, light: { ...DEFAULT_CLAY.light } };
  }
  if (typeof value === 'number') {
    const both = amount(value, 'highlight');
    return { highlight: both, shadow: both, light: { ...DEFAULT_CLAY.light } };
  }
  if (value === null || typeof value !== 'object') {
    throw new TypeError('clay must be a number or an options object.');
  }
  const highlight = value.highlight === undefined ? 1 : amount(value.highlight, 'highlight');
  const shadow = value.shadow === undefined ? 1 : amount(value.shadow, 'shadow');
  const light = value.light ?? {};
  const x = light.x === undefined ? DEFAULT_CLAY.light.x : light.x;
  const y = light.y === undefined ? DEFAULT_CLAY.light.y : light.y;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new TypeError('clay.light.x and clay.light.y must be finite numbers.');
  }
  return { highlight, shadow, light: { x, y } };
}

/** Merge a partial clay change into the current target. */
export function mergeClay(
  base: ClaySettings,
  patch?: number | ClayOptions,
): ClaySettings {
  if (patch === undefined) return base;
  if (typeof patch === 'number') {
    const both = amount(patch, 'highlight');
    return { highlight: both, shadow: both, light: { ...base.light } };
  }
  const highlight = patch.highlight === undefined ? base.highlight : amount(patch.highlight, 'highlight');
  const shadow = patch.shadow === undefined ? base.shadow : amount(patch.shadow, 'shadow');
  const x = patch.light?.x === undefined ? base.light.x : patch.light.x;
  const y = patch.light?.y === undefined ? base.light.y : patch.light.y;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new TypeError('clay.light.x and clay.light.y must be finite numbers.');
  }
  return { highlight, shadow, light: { x, y } };
}

export function lerpClay(a: ClaySettings, b: ClaySettings, t: number): ClaySettings {
  return {
    highlight: a.highlight + (b.highlight - a.highlight) * t,
    shadow: a.shadow + (b.shadow - a.shadow) * t,
    light: {
      x: a.light.x + (b.light.x - a.light.x) * t,
      y: a.light.y + (b.light.y - a.light.y) * t,
    },
  };
}

export function clayEqual(a: ClaySettings, b: ClaySettings): boolean {
  return (
    a.highlight === b.highlight &&
    a.shadow === b.shadow &&
    a.light.x === b.light.x &&
    a.light.y === b.light.y
  );
}
