// Data shapes shared by the engine, the catalogs and both renderers.
// These mirror exactly what BlubEngine.sample() and the pose functions return.

export type ShapeId =
  | 'circle'
  | 'pebble'
  | 'squircle'
  | 'capsule'
  | 'triangle'
  | 'hexagon'
  | 'cloud'
  | 'droplet';

export type ExpressionId =
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

export type StateId =
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

export interface Point {
  x: number;
  y: number;
}

export interface Gaze {
  yaw: number;
  pitch: number;
  roll: number;
}

/** Engine look vector: pointer target blended with the ambient wander. */
export interface Look {
  yaw: number;
  pitch: number;
  mix: number;
  spin: number;
  wander: number;
}

/** 64 radii around a circle plus a uniform scale/offset transform. */
export interface Silhouette {
  radii: number[];
  rot: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export interface EyeShape {
  w: number;
  h: number;
  tilt?: number;
  open: number;
}

export interface Expression {
  id: ExpressionId;
  gaze: Gaze;
  split: number;
  eyes: [EyeShape, EyeShape];
}

/** One ribbon/ring seed, shared by RINGS, SWOOSH and the comet. */
export interface ArcSeed {
  a: number;
  k: number;
  tilt: number;
  speed: number;
  phase: number;
  sweep: number;
  hue: number;
  hueSpan: number;
  width: number;
  cx: number;
  cy: number;
}

export interface DotSpec {
  x: number;
  y: number;
  r: number;
  opacity: number;
  color?: string;
  depth?: number;
  d?: string;
  rot?: number;
}

export interface ArcSpec {
  id: string;
  seed: ArcSeed;
  t: number;
  opacity: number;
}

export interface NotifSpec {
  x: number;
  y: number;
  r: number;
  notch: number;
}

/** The fully posed blub at one instant, before scale and ambient offsets. */
export interface Pose {
  sil: Silhouette;
  offX: number;
  offY: number;
  gaze: Gaze;
  split: number;
  eyes: [EyeShape, EyeShape];
  eyeAlpha: number;
  bodyAlpha: number;
  dots: DotSpec[];
  arcs: ArcSpec[];
  notif: NotifSpec | null;
  dotsBehind: boolean;
}

export interface ArcGradient {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: string[];
}

export interface RenderedArc {
  id: string;
  front: string;
  back: string;
  width: number;
  opacity: number;
  grad: ArcGradient;
}

export interface EyeSample {
  d: string;
  matrix: string;
  alpha: number;
}

export interface RenderDot {
  x: number;
  y: number;
  r: number;
  opacity: number;
  color?: string;
  depth?: number;
  d?: string;
  rot?: number;
}

/** A positioned circle: notification badge or the mask notch cut for it. */
export interface CircleSample {
  x: number;
  y: number;
  r: number;
}

/** A gaussian blur on a part, with the area it needs in viewBox units. */
export interface AccessoryBlur {
  deviation: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One painted piece of a worn accessory. */
export interface AccessoryPart {
  d: string;
  /** A hex colour, or a name resolved against the body: 'auto', 'shadow', 'lip', 'lip-line'. */
  color: string;
  /** Lighter when positive, darker when negative. */
  shade: number;
  opacity: number;
  /** Lit by the body's clay light when the finish is clay. */
  clay: boolean;
  /** Painted through the body mask, so it lies on the surface and never covers an eye. */
  masked: boolean;
  /** Soft-edged parts only; absent means a crisp edge. */
  blur?: AccessoryBlur;
}

export interface AccessorySample {
  id: string;
  parts: AccessoryPart[];
}

/** Everything a renderer needs for one frame. */
/** One playable state: duration, morph window, and the pose it produces. */
export interface StateDef {
  id: StateId;
  duration: number;
  minDuration?: number;
  morph: number;
  blinkIn?: boolean;
  baseFace: boolean;
  baseBody: boolean;
  pose: (t: number) => Pose;
}

export interface BlubSample {
  bodyPath: string;
  bodyAlpha: number;
  eyes: EyeSample[];
  dots: RenderDot[];
  dotsBehind: boolean;
  arcs: RenderedArc[];
  notif: CircleSample | null;
  notch: CircleSample | null;
  /** Present only once something has been worn. */
  accessories?: AccessorySample[];
}
