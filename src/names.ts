// Public labels and lists. Engine ids are the English names; resolution lives in
// src/resolve.ts so the SDK, server, CLI and studio share one implementation.
import {
  SHAPES as ENGINE_SHAPES,
  COLORS as ENGINE_COLORS,
  EXPRESSIONS,
  STATES,
} from './engine/index.js';

export type BlubShape =
  | 'circle'
  | 'pebble'
  | 'squircle'
  | 'capsule'
  | 'triangle'
  | 'hexagon'
  | 'cloud'
  | 'droplet';

export type BlubFace =
  | 'neutral'
  | 'attentive'
  | 'surprised'
  | 'excited'
  | 'happy'
  | 'laughing'
  | 'angry'
  | 'sad'
  | 'scared'
  | 'suspicious'
  | 'confused'
  | 'curious'
  | 'proud'
  | 'shy'
  | 'unimpressed'
  | 'sleepy';

export type BlubAction =
  | 'idle'
  | 'thinking'
  | 'wink'
  | 'wide'
  | 'alert'
  | 'notify'
  | 'exclaim'
  | 'sleep'
  | 'egg'
  | 'hexagon'
  | 'play'
  | 'orbit'
  | 'swirl'
  | 'burst'
  | 'comet';

export const SHAPE_LABEL: Record<string, string> = {
  circle: 'Circle',
  pebble: 'Pebble',
  squircle: 'Squircle',
  capsule: 'Capsule',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  cloud: 'Cloud',
  droplet: 'Droplet',
};

/** Kept in the historical catalog order. */
export const COLOR_LABEL: Record<string, string> = {
  ink: 'Ink',
  cream: 'Cream',
  brown: 'Brown',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  green: 'Green',
  turquoise: 'Turquoise',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  grey: 'Grey',
};

export const FACE_LABEL: Record<string, string> = {
  neutral: 'Neutral',
  attentive: 'Attentive',
  surprised: 'Surprised',
  excited: 'Excited',
  happy: 'Happy',
  laughing: 'Laughing',
  angry: 'Angry',
  sad: 'Sad',
  scared: 'Scared',
  suspicious: 'Suspicious',
  confused: 'Confused',
  curious: 'Curious',
  proud: 'Proud',
  shy: 'Shy',
  unimpressed: 'Unimpressed',
  sleepy: 'Sleepy',
};

export const MOVE_LABEL: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  wink: 'Wink',
  wide: 'Wide',
  alert: 'Alert',
  notify: 'Notify',
  exclaim: 'Exclaim',
  sleep: 'Sleep',
  egg: 'Egg',
  hexagon: 'Hexagon',
  play: 'Play',
  orbit: 'Orbit',
  swirl: 'Swirl',
  burst: 'Burst',
  comet: 'Comet',
};

/** Public shape ids, in engine order. */
export const SHAPES: string[] = ENGINE_SHAPES.map((shape) => shape.id);
/** Public face ids, in engine order. */
export const FACES: string[] = EXPRESSIONS.map((expression) => expression.id);
/** Public colour ids -> hex, in engine order. */
export const COLORS: Record<string, string> = Object.fromEntries(
  ENGINE_COLORS.map((color) => [color.id, color.hex]),
);
/** Engine state ids that can be played. */
export const ACTIONS: string[] = STATES.map((state) => state.id);
