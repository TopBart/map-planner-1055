import type { MapData, ProvinceGrid } from "../core/types";
import type { Bounds } from "./view";

/** Surface 2D minimale : un <canvas> dans l'appli, un canvas Node dans les tests. */
export type Surface = {
  width: number;
  height: number;
  // biome-ignore lint/suspicious/noExplicitAny: contexte 2D du navigateur ou de @napi-rs/canvas
  getContext(type: "2d", options?: any): any;
};
export type SurfaceFactory = (width: number, height: number) => Surface;

export const browserSurface: SurfaceFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** Image alignée sur un rectangle monde (ouest, sud, est, nord). */
export type LayerImage = { surface: Surface; bounds: Bounds };

const MAX_LAYER_SIDE = 4096;
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function hatchPattern(make: SurfaceFactory): Surface {
  // Rayures diagonales : 100 % d'opacité sur le trait, 20 % entre les traits (comme le site).
  const size = 14;
  const tile = make(size, size);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  for (const offset of [-size, 0, size]) {
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
  }
  ctx.stroke();
  return tile;
}

/**
 * Pré-rend toutes les zones interdites dans une image unique, une seule fois par carte.
 * L'affichage ne fait plus qu'un drawImage, quel que soit le nombre de triangles.
 */
export async function buildForbiddenLayer(
  triangles: Float32Array,
  bounds: Bounds,
  make: SurfaceFactory = browserSurface,
  onProgress?: (fraction: number) => void,
  maxSide: number = MAX_LAYER_SIDE
): Promise<LayerImage | null> {
  const count = triangles.length / 6;
  if (!count) return null;
  const [west, south, east, north] = bounds;
  const k = Math.min(maxSide / (east - west), maxSide / (north - south), 4);
  const width = Math.max(1, Math.round((east - west) * k));
  const height = Math.max(1, Math.round((north - south) * k));
  const surface = make(width, height);
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "#ff1f0f";
  ctx.strokeStyle = "#ff1f0f";
  ctx.lineWidth = 1; // recouvre les micro-coutures entre triangles voisins
  ctx.lineJoin = "round";
  const batch = 8000;
  for (let start = 0; start < count; start += batch) {
    const end = Math.min(count, start + batch);
    ctx.beginPath();
    for (let t = start; t < end; t++) {
      const o = t * 6;
      let ax = (triangles[o] - west) * k;
      let ay = (north - triangles[o + 1]) * k;
      let bx = (triangles[o + 2] - west) * k;
      let by = (north - triangles[o + 3]) * k;
      const cx = (triangles[o + 4] - west) * k;
      const cy = (north - triangles[o + 5]) * k;
      // Orientation uniforme : sinon la règle « nonzero » troue les zones qui se recouvrent.
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) {
        [ax, bx] = [bx, ax];
        [ay, by] = [by, ay];
      }
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
    }
    ctx.fill("nonzero");
    ctx.stroke();
    onProgress?.(end / count);
    if (end < count) await yieldToEventLoop();
  }
  // Rayures : l'opacité finale = masque × motif.
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = ctx.createPattern(hatchPattern(make), "repeat");
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  return { surface, bounds };
}

/** Provinces où l'on ne peut pas poser de drapeau (orange) ou de forteresse (violet). */
export function buildProvinceLayer(province: ProvinceGrid, make: SurfaceFactory = browserSurface): LayerImage {
  const { width, height, cells, cellSize } = province;
  const surface = make(width, height);
  const ctx = surface.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const id = cells[row * width + column];
      const flag = province.flagBlocked.has(id);
      const fortress = province.fortressBlocked.has(id);
      if (!flag && !fortress) continue;
      // La ligne 0 est au sud : on retourne verticalement pour l'affichage (nord en haut).
      const at = ((height - 1 - row) * width + column) * 4;
      const [r, g, b] = flag && fortress ? [239, 68, 68] : flag ? [249, 115, 22] : [168, 85, 247];
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { surface, bounds: [0, 0, width * cellSize, height * cellSize] };
}

export function hasProvinceRestrictions(data: MapData): boolean {
  const p = data.province;
  return !!p && (p.flagBlocked.size > 0 || p.fortressBlocked.size > 0);
}
