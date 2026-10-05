import type { Plan, Point } from "../core/types";
import { type Bounds, type View, worldToScreen, zoomOf } from "./view";

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Élément (annotation ou bâtiment) sous le pointeur, en pixels écran ; les plus récents d'abord. */
export function pickAt(plan: Plan, view: View, bounds: Bounds, sx: number, sy: number): string | undefined {
  for (let i = plan.annotations.length - 1; i >= 0; i--) {
    const a = plan.annotations[i];
    const p = a.points.map(([x, y]) => worldToScreen(view, x, y));
    if (a.kind === "circle") {
      const radius = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
      if (Math.abs(Math.hypot(sx - p[0][0], sy - p[0][1]) - radius) < 10) return a.id;
    } else if (p.length === 1) {
      const lift = a.kind === "marker" ? 6 + a.width * 1.5 : 0;
      if (Math.hypot(sx - p[0][0], sy - p[0][1] + lift * 2) < (a.kind === "text" ? 40 : 18)) return a.id;
    } else if (p.slice(1).some((b, k) => distanceToSegment([sx, sy], p[k], b) < 10)) return a.id;
  }
  const zoom = zoomOf(view, bounds);
  for (let i = plan.buildings.length - 1; i >= 0; i--) {
    const b = plan.buildings[i];
    if (b.kind === "flag" && zoom <= 5) continue;
    const [x, y] = worldToScreen(view, b.x, b.y);
    if (Math.hypot(sx - x, sy - y) < 18) return b.id;
  }
  return undefined;
}
