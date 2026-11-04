// Small shared helper kept separate so moments.ts does not import the SDK API.
import { requireColor } from '../resolve.js';
import type { Color } from './commands.js';

export function requestColor(value: unknown): Color {
  return requireColor(value) as Color;
}
