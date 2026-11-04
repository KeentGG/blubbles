// Body sampling: apply the ambient drift/breath to the posed silhouette, rasterise
// its 64 points and turn them into one closed Catmull-Rom path.
import { catmullRomPath, rasterizeSilhouette } from '../geometry/silhouette.js';
import type { Point, Pose } from '../types.js';

export function bodyPathFor(
  pose: Pose,
  offsetX: number,
  offsetY: number,
  breath: number,
  scale: number,
  points: Point[],
): string {
  return catmullRomPath(
    rasterizeSilhouette(
      {
        ...pose.sil,
        cx: pose.sil.cx + offsetX,
        cy: pose.sil.cy + offsetY,
        sy: pose.sil.sy * breath,
      },
      scale,
      points,
    ),
  );
}
