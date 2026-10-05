import { TERRITORY_UNIT, cellKey } from "./geometry";
import type { Warped } from "./overlay";

export type Rgb = [number, number, number];

/** Cases de territoire dont une part suffisante des pixels redressés ressemble à la couleur choisie (contour d'une alliance). */
export function detectBorderCells(warped: Warped, color: Rgb, tolerance: number, minCoverage: number): Set<string> {
  const { raster, bounds } = warped;
  const [west, south, east, north] = bounds;
  const kx = raster.width / (east - west);
  const ky = raster.height / (north - south);
  const tol2 = tolerance * tolerance;
  const cells = new Set<string>();
  const c0 = Math.floor(west / TERRITORY_UNIT);
  const c1 = Math.floor((east - 1e-6) / TERRITORY_UNIT);
  const r0 = Math.floor(south / TERRITORY_UNIT);
  const r1 = Math.floor((north - 1e-6) / TERRITORY_UNIT);
  const d = raster.data;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      // Rectangle de la case en pixels (le nord est en haut de l'image).
      const px0 = Math.max(0, Math.floor((col * TERRITORY_UNIT - west) * kx));
      const px1 = Math.min(raster.width, Math.ceil(((col + 1) * TERRITORY_UNIT - west) * kx));
      const py0 = Math.max(0, Math.floor((north - (row + 1) * TERRITORY_UNIT) * ky));
      const py1 = Math.min(raster.height, Math.ceil((north - row * TERRITORY_UNIT) * ky));
      let seen = 0;
      let hit = 0;
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) {
          const o = (y * raster.width + x) * 4;
          if (d[o + 3] === 0) continue;
          seen++;
          const dr = d[o] - color[0];
          const dg = d[o + 1] - color[1];
          const db = d[o + 2] - color[2];
          if (dr * dr + dg * dg + db * db <= tol2) hit++;
        }
      }
      // Une case n'est retenue que si elle est assez visible (au moins la moitié de sa surface).
      const area = Math.max(1, (px1 - px0) * (py1 - py0));
      if (seen >= area * 0.5 && hit / seen >= minCoverage) cells.add(cellKey(col, row));
    }
  }
  return cells;
}

export type Region = { owned: Set<string>; holes: number };

/** Territoire déduit : les cases de contour plus les zones qu'elles enferment (remplissage depuis l'extérieur de la zone visible). */
export function fillRegion(border: Set<string>, visible: Set<string> | null): Region {
  if (!border.size) return { owned: new Set(), holes: 0 };
  const parse = (k: string): [number, number] => {
    const [c, r] = k.split(":").map(Number);
    return [c, r];
  };
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const k of border) {
    const [c, r] = parse(k);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  minC--; minR--; maxC++; maxR++;
  const outside = new Set<string>();
  const stack: [number, number][] = [[minC, minR]];
  outside.add(cellKey(minC, minR));
  while (stack.length) {
    const [c, r] = stack.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
      const k = cellKey(nc, nr);
      if (outside.has(k) || border.has(k)) continue;
      outside.add(k);
      stack.push([nc, nr]);
    }
  }
  const owned = new Set(border);
  let holes = 0;
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++) {
      const k = cellKey(c, r);
      if (!outside.has(k) && !border.has(k) && (!visible || visible.has(k))) {
        owned.add(k);
        holes++;
      }
    }
  return { owned, holes };
}

/** Drapeaux (carrés de 3×3 cases) couvrant au mieux le territoire : choix glouton, chaque carré doit tenir entièrement dedans. */
export function suggestFlags(owned: Set<string>, limit: number): { column: number; row: number }[] {
  const uncovered = new Set(owned);
  const fits = (c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!owned.has(cellKey(c + dc, r + dr))) return false;
    return true;
  };
  const candidates: [number, number][] = [];
  for (const k of owned) {
    const [c, r] = k.split(":").map(Number);
    if (fits(c, r)) candidates.push([c, r]);
  }
  const gain = (c: number, r: number) => {
    let g = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (uncovered.has(cellKey(c + dc, r + dr))) g++;
    return g;
  };
  const chosen: { column: number; row: number }[] = [];
  while (chosen.length < limit) {
    let best: [number, number] | null = null;
    let bestGain = 0;
    for (const [c, r] of candidates) {
      const g = gain(c, r);
      if (g > bestGain) {
        bestGain = g;
        best = [c, r];
        if (g === 9) break;
      }
    }
    if (!best || bestGain < 3) break;
    chosen.push({ column: best[0], row: best[1] });
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) uncovered.delete(cellKey(best[0] + dc, best[1] + dr));
  }
  return chosen;
}
