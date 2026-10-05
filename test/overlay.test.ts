import { describe, expect, it } from "vitest";
import { applyH, reprojectionError, solveHomography, type Mat3 } from "../src/core/homography";
import { warpToWorld, type Raster } from "../src/core/overlay";
import { detectBorderCells, fillRegion, suggestFlags } from "../src/core/trace";
import type { Point } from "../src/core/types";

// Vue en perspective factice : monde (0..360) → « capture » 800×600, avec fuite vers le haut.
const worldToShot: Mat3 = [2.2, 0.35, 40, 0.05, -1.4, 560, 0.0006, -0.0009, 1];

describe("homographie", () => {
  it("retrouve la transformation à partir de 4 repères, même imprécis", () => {
    const world: Point[] = [[20, 20], [340, 30], [330, 330], [30, 320], [180, 170]];
    const shot = world.map((p) => applyH(worldToShot, p)!);
    const noisy = shot.map(([x, y], i): Point => [x + (i % 2 ? 0.4 : -0.3), y + (i % 3 ? -0.2 : 0.3)]);
    const h = solveHomography(noisy, world)!;
    expect(reprojectionError(h, noisy, world)).toBeLessThan(1.5);
    const probe = applyH(h, applyH(worldToShot, [100, 250])!)!;
    expect(probe[0]).toBeCloseTo(100, 0);
    expect(probe[1]).toBeCloseTo(250, 0);
  });
  it("refuse moins de 4 paires", () => {
    expect(solveHomography([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]])).toBeNull();
  });
});

describe("redressement et détection", () => {
  // Monde synthétique : les cases (col 2..9, row 2..9) forment un territoire dont le contour est orange.
  const orange: [number, number, number] = [200, 120, 40];
  function makeShot(): Raster {
    const w = 800, h = 600;
    const data = new Uint8ClampedArray(w * h * 4);
    const inv = (() => { const h = solveHomography(
      [[0, 0], [360, 0], [360, 360], [0, 360]].map((p) => applyH(worldToShot, p as Point)!),
      [[0, 0], [360, 0], [360, 360], [0, 360]]
    )!; return h; })();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = applyH(inv, [x + 0.5, y + 0.5])!;
      const col = Math.floor(p[0] / 18), row = Math.floor(p[1] / 18);
      const inside = col >= 2 && col <= 9 && row >= 2 && row <= 9;
      const edge = inside && (col === 2 || col === 9 || row === 2 || row === 9);
      const o = (y * w + x) * 4;
      const rgb = edge ? orange : [150, 170, 64];
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
    return { width: w, height: h, data };
  }

  it("redresse la capture, repère les cases de contour, déduit le territoire et propose des drapeaux", () => {
    const shot = makeShot();
    // Repères choisis dans la capture : 4 coins du monde 0..360 (valeurs exactes pour isoler la chaîne de traitement).
    const world: Point[] = [[0, 0], [360, 0], [360, 360], [0, 360]];
    const img = world.map((p) => applyH(worldToShot, p)!);
    const h = solveHomography(img, world)!;
    const warped = warpToWorld(shot, h, [0, 0, 360, 360])!;
    expect(warped).not.toBeNull();
    const border = detectBorderCells(warped, orange, 30, 0.4);
    // 8×8 cases dont le contour fait 28 cases
    expect(border.size).toBeGreaterThanOrEqual(26);
    expect(border.size).toBeLessThanOrEqual(30);
    const { owned } = fillRegion(border, null);
    expect(owned.size).toBeGreaterThanOrEqual(60);
    const flags = suggestFlags(owned, 50);
    expect(flags.length).toBeGreaterThan(3);
    expect(flags.length).toBeLessThanOrEqual(12);
  });
});
