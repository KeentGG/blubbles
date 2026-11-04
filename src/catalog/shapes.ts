// Shape catalog: the eight body silhouettes and the two silhouette helpers used
// by state poses. Radii are 64 samples around a circle, in engine units.
import {
  arcPolygon,
  normalizeRadii,
  raycastRadii,
  roundedPolygon,
  smoothUnionRadii,
} from '../geometry/silhouette.js';
import { TAU } from '../math/index.js';
import type { ShapeId, Silhouette } from '../types.js';

export interface Shape {
  id: ShapeId;
  radii: number[];
}

/** Hand-tuned radii for the rounded-triangle family (also used by some poses). */
const BASE_RADII: Record<'egg' | 'hexagon' | 'triangle', number[]> = {
  egg: [
    0.8369, 0.8424, 0.8497, 0.8585, 0.8674, 0.8775, 0.8878, 0.8983,
    0.9089, 0.9185, 0.9288, 0.9374, 0.9445, 0.9504, 0.9543, 0.9559,
    0.9555, 0.9519, 0.9466, 0.9389, 0.9302, 0.9193, 0.9085, 0.8969,
    0.8852, 0.8734, 0.8625, 0.8513, 0.8411, 0.8325, 0.8243, 0.8179,
    0.8137, 0.8112, 0.8102, 0.8128, 0.8178, 0.8262, 0.8374, 0.8518,
    0.8702, 0.8922, 0.9169, 0.9446, 0.9741, 1.0023, 1.0267, 1.0433,
    1.0481, 1.0393, 1.0216, 0.997, 0.9697, 0.9418, 0.9169, 0.8949, 0.876,
    0.8604, 0.849, 0.8394, 0.8337, 0.8314, 0.8305, 0.8326,
  ],
  hexagon: [
    0.921, 0.9282, 0.9441, 0.9706, 0.9984, 1.0059, 0.9896, 0.9562, 0.929,
    0.9124, 0.9047, 0.9058, 0.9157, 0.9349, 0.9642, 0.9873, 0.9882,
    0.9665, 0.9336, 0.9105, 0.8968, 0.8918, 0.8955, 0.908, 0.9293, 0.9611,
    0.982, 0.9812, 0.959, 0.9282, 0.9089, 0.8978, 0.8964, 0.9026, 0.9189,
    0.9439, 0.9778, 0.999, 0.9964, 0.9713, 0.9439, 0.9274, 0.9196, 0.9206,
    0.9308, 0.9502, 0.9799, 1.0121, 1.0226, 1.0071, 0.9752, 0.951, 0.9366,
    0.9316, 0.9351, 0.9485, 0.9711, 1.0026, 1.0213, 1.0155, 0.9863,
    0.9547, 0.9347, 0.9232,
  ],
  triangle: [
    0.7819, 0.8211, 0.8747, 0.944, 1.0223, 1.096, 1.1401, 1.134, 1.0808,
    1.0047, 0.9265, 0.8603, 0.8104, 0.773, 0.745, 0.7273, 0.7151, 0.7118,
    0.7148, 0.7245, 0.7427, 0.768, 0.8037, 0.8518, 0.9148, 0.9876, 1.0583,
    1.1073, 1.1109, 1.0667, 0.994, 0.9164, 0.8482, 0.7948, 0.7555, 0.7261,
    0.7056, 0.6925, 0.6859, 0.6869, 0.6938, 0.7084, 0.7305, 0.7615, 0.804,
    0.8595, 0.9311, 1.0092, 1.0791, 1.1171, 1.1054, 1.0501, 0.9779, 0.905,
    0.845, 0.799, 0.7656, 0.7413, 0.7258, 0.716, 0.7146, 0.7204, 0.733,
    0.7528,
  ],
};

/** A silhouette built from one of the hand-tuned radii tables. */
export function shapeFromBase(
  id: 'egg' | 'hexagon' | 'triangle',
  overrides: Partial<Silhouette> = {},
): Silhouette {
  return {
    radii: [...BASE_RADII[id]],
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...overrides,
  };
}

/** A perfect circle, optionally offset or scaled. */
export function circleShape(radius: number, overrides: Partial<Silhouette> = {}): Silhouette {
  return {
    radii: Array(64).fill(radius),
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...overrides,
  };
}

/** A silhouette from an explicit radii table (used by the alert/exclaim poses). */
export function silhouetteFromRadii(
  radii: number[],
  overrides: Partial<Silhouette> = {},
): Silhouette {
  return {
    radii: [...radii],
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...overrides,
  };
}

function cachedRadii(build: () => number[]): () => number[] {
  let value: number[] | null = null;
  return () => {
    if (!value) value = build();
    return value;
  };
}

const circleRadii = cachedRadii(() => Array(64).fill(1));

const pebbleRadii = cachedRadii(() =>
  normalizeRadii(
    Array.from({ length: 64 }, (_, i) => (i / 64) * Math.PI * 2).map(
      (angle) => 1 + 0.075 * Math.cos(2 * angle + 0.5) + 0.035 * Math.cos(3 * angle + 2.1),
    ),
    1.02,
  ),
);

const squircleRadii = cachedRadii(() =>
  normalizeRadii(
    Array.from({ length: 64 }, (_, i) => {
      const angle = (i / 64) * TAU;
      const x = Math.abs(Math.cos(angle) / 1) ** 4.2;
      const y = Math.abs(Math.sin(angle) / 1) ** 4.2;
      return (x + y) ** (-1 / 4.2);
    }),
    1.15,
  ),
);

const capsuleRadii = cachedRadii(() =>
  raycastRadii(arcPolygon(-0.42, 0, 0.62, 0.42, 0, 0.62), 0, 0),
);

const triangleRadii = cachedRadii(() => roundedPolygon(3, 1.12, 0.34, -90));

const hexagonRadii = cachedRadii(() => roundedPolygon(6, 1.04, 0.26, 0));

const cloudRadii = cachedRadii(() =>
  smoothUnionRadii(
    [
      { x: -0.44, y: 0.2, r: 0.54 },
      { x: 0.46, y: 0.2, r: 0.5 },
      { x: 0.02, y: 0.3, r: 0.6 },
      { x: -0.24, y: -0.3, r: 0.48 },
      { x: 0.3, y: -0.24, r: 0.44 },
    ],
    1.02,
  ),
);

const dropletRadii = cachedRadii(() =>
  normalizeRadii(raycastRadii(arcPolygon(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0), 1.04),
);

export const SHAPES: Shape[] = [
  { id: 'circle', get radii(): number[] { return circleRadii(); } },
  { id: 'pebble', get radii(): number[] { return pebbleRadii(); } },
  { id: 'squircle', get radii(): number[] { return squircleRadii(); } },
  { id: 'capsule', get radii(): number[] { return capsuleRadii(); } },
  { id: 'triangle', get radii(): number[] { return triangleRadii(); } },
  { id: 'hexagon', get radii(): number[] { return hexagonRadii(); } },
  { id: 'cloud', get radii(): number[] { return cloudRadii(); } },
  { id: 'droplet', get radii(): number[] { return dropletRadii(); } },
];

export const SHAPE_BY_ID = new Map<string, Shape>(SHAPES.map((shape) => [shape.id, shape]));
