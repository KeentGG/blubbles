// Ambient motion: the always-on wander, blink schedule, body drift and breath.
// Everything here is a pure function of time.
import { createRng, loopNoise } from '../math/index.js';

export interface AmbientOptions {
  wander?: number;
  blink?: boolean;
  float?: boolean;
}

export interface AmbientMotion {
  dYaw: number;
  dPitch: number;
  dRoll: number;
  lid: number;
  driftX: number;
  driftY: number;
  breath: number;
}

/** Seeded blink times: gaps of 1.9..4.6 s, with an 18% chance of a double blink. */
const BLINKS = (() => {
  const rng = createRng(24301);
  const times: number[] = [];
  let t = 1.4;
  while (t < 900) {
    times.push(t);
    t += 1.9 + 2.7 * rng();
    if (0.18 > rng()) {
      times.push(t);
      t += 0.24;
    }
  }
  return times;
})();

/** Eyelid openness at `t`: 1 is open, 0 is fully closed. A blink lasts 0.18 s. */
export function lidAt(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const at = BLINKS[i];
    if (t < at) break;
    const phase = (t - at) / 0.18;
    if (phase >= 0 && phase <= 1) {
      return phase < 0.45 ? 1 - phase / 0.45 : (phase - 0.45) / 0.55;
    }
  }
  return 1;
}

export function ambientMotion(
  t: number,
  { wander = 1, blink = true, float = true }: AmbientOptions = {},
): AmbientMotion {
  return {
    dYaw: (5.5 * loopNoise(t, 11.3, 0.4) + 1.6 * loopNoise(t, 3.7, 2.1)) * wander,
    dPitch: (4.2 * loopNoise(t, 9.1, 1.3) + 1.3 * loopNoise(t, 4.3, 0.7)) * wander,
    dRoll: 2.2 * loopNoise(t, 13.7, 3.2) * wander,
    lid: blink ? lidAt(t) : 1,
    driftX: float ? 0.006 * loopNoise(t, 7.9, 1.9) : 0,
    driftY: float ? 0.007 * loopNoise(t, 5.3, 0.3) : 0,
    breath: float ? 1 + 0.005 * Math.sin((t / 3.4) * Math.PI * 2) : 1,
  };
}
