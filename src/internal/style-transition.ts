// Smooth display style for colour, paper/eye and clay intensity. The target is
// kept separately, so state.color can report the destination immediately.
import { mixOklab } from '../oklab.js';
import { lerpClay } from '../sdk/clay.js';
import type { ClaySettings } from '../sdk/clay.js';

export interface ViewStyle {
  color: string;
  paper: string;
  eye: string;
  finish: 'clay' | 'flat';
  clay: ClaySettings;
}

export interface StyleTransition {
  readonly target: ViewStyle;
  at(now: number): ViewStyle;
  set(next: ViewStyle, now: number, duration: number): void;
  jump(next: ViewStyle): void;
}

const clone = (style: ViewStyle): ViewStyle => ({
  color: style.color,
  paper: style.paper,
  eye: style.eye,
  finish: style.finish,
  clay: { highlight: style.clay.highlight, shadow: style.clay.shadow, light: { ...style.clay.light } },
});

export function createStyleTransition(initial: ViewStyle): StyleTransition {
  let from = clone(initial);
  let to = clone(initial);
  let startedAt = 0;
  let duration = 0;

  const at = (now: number): ViewStyle => {
    if (duration <= 0) return clone(to);
    const t = (now - startedAt) / duration;
    if (t <= 0) return clone(from);
    if (t >= 1) return clone(to);
    return {
      color: mixOklab(from.color, to.color, t),
      paper: mixOklab(from.paper, to.paper, t),
      eye: mixOklab(from.eye, to.eye, t),
      finish: to.finish,
      clay: lerpClay(from.clay, to.clay, t),
    };
  };

  return {
    get target(): ViewStyle {
      return clone(to);
    },
    at,
    set(next: ViewStyle, now: number, nextDuration: number): void {
      const current = at(now);
      from = current;
      to = clone(next);
      startedAt = now;
      duration = Math.max(0, nextDuration);
      if (duration === 0) from = clone(next);
    },
    jump(next: ViewStyle): void {
      from = clone(next);
      to = clone(next);
      duration = 0;
    },
  };
}
