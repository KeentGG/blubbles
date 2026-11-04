// Radius hysteresis for pointer following: enter at `radius`, leave at
// `exitRadius`, so a cursor sitting on the edge does not flicker.
export type FollowLeave = 'previous' | 'wander' | 'center';

export interface FollowOptions {
  /** Number of CSS px from the centre, or 'element' for the blub's own box. */
  radius?: number | 'element';
  /** Leave radius in CSS px. Default radius * 1.25; must be >= radius. */
  exitRadius?: number;
  onLeave?: FollowLeave;
}

export interface NormalizedFollow {
  radius: number | 'element' | null;
  exitRadius: number | null;
  onLeave: FollowLeave;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FollowGate {
  readonly inside: boolean;
  update(x: number, y: number, rect: Rect): 'enter' | 'leave' | 'move' | 'none';
  leave(): boolean;
}

const LEAVES: FollowLeave[] = ['previous', 'wander', 'center'];

export function normalizeFollow(options: FollowOptions = {}): NormalizedFollow {
  const onLeave = options.onLeave ?? 'previous';
  if (!LEAVES.includes(onLeave)) {
    throw new TypeError(
      `follow.onLeave must be "previous", "wander" or "center", got ${JSON.stringify(onLeave)}.`,
    );
  }
  if (options.radius === undefined) {
    return { radius: null, exitRadius: null, onLeave };
  }
  if (options.radius === 'element') {
    if (options.exitRadius !== undefined) {
      throw new TypeError('follow.exitRadius only applies to a numeric radius.');
    }
    return { radius: 'element', exitRadius: null, onLeave };
  }
  if (typeof options.radius !== 'number' || !Number.isFinite(options.radius) || options.radius <= 0) {
    throw new TypeError('follow.radius must be a positive number or "element".');
  }
  const exitRadius = options.exitRadius ?? options.radius * 1.25;
  if (!Number.isFinite(exitRadius) || exitRadius < options.radius) {
    throw new TypeError('follow.exitRadius must be a number >= radius.');
  }
  return { radius: options.radius, exitRadius, onLeave };
}

export function createFollowGate(options: NormalizedFollow): FollowGate {
  let inside = false;
  return {
    get inside(): boolean {
      return inside;
    },
    update(x: number, y: number, rect: Rect): 'enter' | 'leave' | 'move' | 'none' {
      if (options.radius === 'element') {
        const within =
          x >= rect.left &&
          x <= rect.left + rect.width &&
          y >= rect.top &&
          y <= rect.top + rect.height;
        if (within && !inside) {
          inside = true;
          return 'enter';
        }
        if (!within && inside) {
          inside = false;
          return 'leave';
        }
        return within ? 'move' : 'none';
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(x - cx, y - cy);
      if (options.radius === null) {
        if (!inside) {
          inside = true;
          return 'enter';
        }
        return 'move';
      }
      if (!inside && distance <= options.radius) {
        inside = true;
        return 'enter';
      }
      if (inside && options.exitRadius !== null && distance > options.exitRadius) {
        inside = false;
        return 'leave';
      }
      return inside ? 'move' : 'none';
    },
    leave(): boolean {
      if (!inside) return false;
      inside = false;
      return true;
    },
  };
}
