import type { Point } from "./types";

/** Matrice 3×3 en ligne : [h0 h1 h2; h3 h4 h5; h6 h7 h8]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function applyH(h: Mat3, [x, y]: Point): Point | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function denominator(h: Mat3, [x, y]: Point): number {
  return h[6] * x + h[7] * y + h[8];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

/** Normalisation de Hartley : centre sur l'origine, distance moyenne √2 (indispensable pour un système bien conditionné). */
function normalization(points: Point[]): Mat3 {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const mean = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1;
  const k = Math.SQRT2 / mean;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Homographie qui envoie chaque point `from[i]` sur `to[i]` (≥ 4 paires, moindres carrés). */
export function solveHomography(from: Point[], to: Point[]): Mat3 | null {
  if (from.length < 4 || from.length !== to.length) return null;
  const ts = normalization(from);
  const td = normalization(to);
  const tdInv = invert(td);
  if (!tdInv) return null;
  const rows: number[][] = [];
  const rhs: number[] = [];
  from.forEach((p, i) => {
    const s = applyH(ts as Mat3, p)!;
    const d = applyH(td as Mat3, to[i])!;
    rows.push([s[0], s[1], 1, 0, 0, 0, -d[0] * s[0], -d[0] * s[1]]);
    rhs.push(d[0]);
    rows.push([0, 0, 0, s[0], s[1], 1, -d[1] * s[0], -d[1] * s[1]]);
    rhs.push(d[1]);
  });
  const ata = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const atb = Array.from({ length: 8 }, (_, i) => rows.reduce((s, r, k) => s + r[i] * rhs[k], 0));
  const h = solveLinear(ata, atb);
  if (!h) return null;
  return multiply(multiply(tdInv, [...h, 1] as Mat3), ts);
}

/** Erreur quadratique moyenne de la reprojection, dans l'unité de `to`. */
export function reprojectionError(h: Mat3, from: Point[], to: Point[]): number {
  let sum = 0;
  from.forEach((p, i) => {
    const q = applyH(h, p);
    sum += q ? (q[0] - to[i][0]) ** 2 + (q[1] - to[i][1]) ** 2 : 1e12;
  });
  return Math.sqrt(sum / from.length);
}
