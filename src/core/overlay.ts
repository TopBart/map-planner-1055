import { applyH, denominator, invert, type Mat3 } from "./homography";
import type { Point } from "./types";

export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export type WorldBounds = [number, number, number, number]; // ouest, sud, est, nord
export type Warped = { raster: Raster; bounds: WorldBounds };

const MAX_SIDE = 3072;

/** Unités du monde couvertes par un pixel de la capture au voisinage de p. */
function unitsPerPixel(h: Mat3, p: Point): number {
  const a = applyH(h, p);
  const b = applyH(h, [p[0] + 1, p[1]]);
  const c = applyH(h, [p[0], p[1] + 1]);
  if (!a || !b || !c) return Infinity;
  return (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - a[0], c[1] - a[1])) / 2;
}

/**
 * Redresse une capture (vue en perspective) en vue de dessus alignée sur le monde.
 * `imageToWorld` envoie les pixels de la capture vers les coordonnées du monde.
 * `limit` borne la zone produite (zone de la carte) ; renvoie null si la capture est dégénérée (horizon visible, etc.).
 */
export function warpToWorld(src: Raster, imageToWorld: Mat3, limit: WorldBounds): Warped | null {
  const inv = invert(imageToWorld);
  if (!inv) return null;
  const corners: Point[] = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
  const sign = Math.sign(denominator(imageToWorld, [src.width / 2, src.height / 2]));
  if (corners.some((c) => Math.sign(denominator(imageToWorld, c)) !== sign)) return null;
  const world = corners.map((c) => applyH(imageToWorld, c));
  if (world.some((w) => !w)) return null;
  const xs = world.map((w) => w![0]);
  const ys = world.map((w) => w![1]);
  const bounds: WorldBounds = [
    Math.max(limit[0], Math.min(...xs)),
    Math.max(limit[1], Math.min(...ys)),
    Math.min(limit[2], Math.max(...xs)),
    Math.min(limit[3], Math.max(...ys)),
  ];
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  if (!(width > 1 && height > 1)) return null;
  // Résolution : celle du point le plus net de la capture (plafonnée), pour ne rien perdre là où l'image est précise.
  const sharpest = Math.min(...[...corners, [src.width / 2, src.height / 2] as Point].map((p) => unitsPerPixel(imageToWorld, p)));
  let k = 1 / Math.max(sharpest, 1e-6);
  k = Math.min(k, MAX_SIDE / width, MAX_SIDE / height);
  const outW = Math.max(1, Math.round(width * k));
  const outH = Math.max(1, Math.round(height * k));
  const center = applyH(imageToWorld, [src.width / 2, src.height / 2]);
  if (!center) return null;
  const invSign = Math.sign(denominator(inv, center));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const s = src.data;
  for (let j = 0; j < outH; j++) {
    const wy = bounds[3] - ((j + 0.5) / outH) * height;
    for (let i = 0; i < outW; i++) {
      const wx = bounds[0] + ((i + 0.5) / outW) * width;
      const den = inv[6] * wx + inv[7] * wy + inv[8];
      if (Math.sign(den) !== invSign || Math.abs(den) < 1e-12) continue;
      const u = (inv[0] * wx + inv[1] * wy + inv[2]) / den - 0.5;
      const v = (inv[3] * wx + inv[4] * wy + inv[5]) / den - 0.5;
      if (u < 0 || v < 0 || u > src.width - 1 || v > src.height - 1) continue;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, src.width - 1);
      const y1 = Math.min(y0 + 1, src.height - 1);
      const fx = u - x0;
      const fy = v - y0;
      const o = (j * outW + i) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[(y0 * src.width + x0) * 4 + c] * (1 - fx) + s[(y0 * src.width + x1) * 4 + c] * fx;
        const bottom = s[(y1 * src.width + x0) * 4 + c] * (1 - fx) + s[(y1 * src.width + x1) * 4 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { raster: { width: outW, height: outH, data: out }, bounds };
}
