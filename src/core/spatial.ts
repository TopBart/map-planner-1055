import { circleIntersectsTriangle } from "./geometry";
import type { MeshDefinition, MeshInstance } from "./types";

/**
 * Index spatial des triangles interdits (grille en CSR).
 * Le site parcourt tous les triangles à chaque mouvement de souris ; ici une requête ne
 * touche que les cellules proches du curseur, ce qui garde la prévisualisation fluide
 * même sur une carte complète.
 */
export class TriangleIndex {
  /** Sommets des triangles dans le monde : 6 nombres par triangle (ax, ay, bx, by, cx, cy). */
  readonly triangles: Float32Array;
  readonly count: number;
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly cellStart: Uint32Array;
  private readonly cellItems: Uint32Array;
  private readonly stamps: Uint32Array;
  private stamp = 0;

  constructor(definitions: readonly MeshDefinition[], instances: readonly MeshInstance[], cellSize = 48) {
    // Les instances référencent l'identifiant de la définition, pas sa position dans le tableau.
    const byId = new Map<number, MeshDefinition>();
    for (const definition of definitions) byId.set(definition.id, definition);
    let total = 0;
    for (const instance of instances) total += Math.floor((byId.get(instance.mesh)?.indices.length ?? 0) / 3);
    const triangles = new Float32Array(total * 6);
    let at = 0;
    for (const instance of instances) {
      const definition = byId.get(instance.mesh);
      if (!definition) continue;
      const [a, b, c, d, tx, ty] = instance.affine;
      const { vertices, indices } = definition;
      for (let i = 0; i + 2 < indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vertex = vertices[indices[i + k]];
          if (!vertex) throw new Error("Indice de maillage hors sommets");
          triangles[at++] = a * vertex[0] + b * vertex[1] + tx;
          triangles[at++] = c * vertex[0] + d * vertex[1] + ty;
        }
      }
    }
    this.triangles = triangles;
    this.count = total;
    this.cellSize = cellSize;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < triangles.length; i += 2) {
      minX = Math.min(minX, triangles[i]);
      maxX = Math.max(maxX, triangles[i]);
      minY = Math.min(minY, triangles[i + 1]);
      maxY = Math.max(maxY, triangles[i + 1]);
    }
    if (!total) {
      minX = minY = 0;
      maxX = maxY = 1;
    }
    this.minX = minX;
    this.minY = minY;
    this.columns = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);

    const cells = this.columns * this.rows;
    const counts = new Uint32Array(cells + 1);
    const each = (visit: (cell: number, triangle: number) => void) => {
      for (let t = 0; t < total; t++) {
        const o = t * 6;
        const x0 = Math.min(triangles[o], triangles[o + 2], triangles[o + 4]);
        const x1 = Math.max(triangles[o], triangles[o + 2], triangles[o + 4]);
        const y0 = Math.min(triangles[o + 1], triangles[o + 3], triangles[o + 5]);
        const y1 = Math.max(triangles[o + 1], triangles[o + 3], triangles[o + 5]);
        const c0 = Math.floor((x0 - minX) / cellSize);
        const c1 = Math.floor((x1 - minX) / cellSize);
        const r0 = Math.floor((y0 - minY) / cellSize);
        const r1 = Math.floor((y1 - minY) / cellSize);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) visit(r * this.columns + c, t);
      }
    };
    each((cell) => counts[cell + 1]++);
    for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
    this.cellStart = counts;
    this.cellItems = new Uint32Array(counts[cells]);
    const fill = counts.slice(0, cells);
    each((cell, triangle) => {
      this.cellItems[fill[cell]++] = triangle;
    });
    this.stamps = new Uint32Array(total);
  }

  /** Vrai si le disque touche au moins un triangle interdit. */
  circleHits(x: number, y: number, radius: number): boolean {
    if (!this.count) return false;
    const c0 = Math.max(0, Math.floor((x - radius - this.minX) / this.cellSize));
    const c1 = Math.min(this.columns - 1, Math.floor((x + radius - this.minX) / this.cellSize));
    const r0 = Math.max(0, Math.floor((y - radius - this.minY) / this.cellSize));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius - this.minY) / this.cellSize));
    if (c1 < 0 || r1 < 0 || c0 > this.columns - 1 || r0 > this.rows - 1) return false;
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const t = this.triangles;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.columns + c;
        for (let i = this.cellStart[cell]; i < this.cellStart[cell + 1]; i++) {
          const triangle = this.cellItems[i];
          if (this.stamps[triangle] === this.stamp) continue;
          this.stamps[triangle] = this.stamp;
          const o = triangle * 6;
          if (circleIntersectsTriangle(x, y, radius, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]))
            return true;
        }
      }
    }
    return false;
  }
}
