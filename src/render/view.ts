import type { Point } from "../core/types";

/** Vue : centre en coordonnées monde (x vers l'est, y vers le nord), échelle en pixels par unité. */
export type View = { cx: number; cy: number; scale: number; width: number; height: number };
export type Bounds = [number, number, number, number]; // ouest, sud, est, nord

export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 40;
export const FIT_MARGIN = 0.94;

export function worldToScreen(view: View, x: number, y: number): Point {
  return [(x - view.cx) * view.scale + view.width / 2, (view.cy - y) * view.scale + view.height / 2];
}

export function screenToWorld(view: View, sx: number, sy: number): Point {
  return [(sx - view.width / 2) / view.scale + view.cx, view.cy - (sy - view.height / 2) / view.scale];
}

/** Échelle qui fait tenir toute l'image dans la vue (avec une petite marge). */
export function fitScale(width: number, height: number, bounds: Bounds): number {
  const [west, south, east, north] = bounds;
  return Math.max(1e-6, Math.min(width / (east - west), height / (north - south)) * FIT_MARGIN);
}

export function zoomOf(view: View, bounds: Bounds): number {
  return view.scale / fitScale(view.width, view.height, bounds);
}

export function fitView(width: number, height: number, bounds: Bounds): View {
  return {
    cx: (bounds[0] + bounds[2]) / 2,
    cy: (bounds[1] + bounds[3]) / 2,
    scale: fitScale(width, height, bounds),
    width,
    height,
  };
}

export function panView(view: View, dx: number, dy: number): View {
  return { ...view, cx: view.cx - dx / view.scale, cy: view.cy + dy / view.scale };
}

/** Zoom centré sur un point de l'écran ; le zoom est borné par rapport à l'ajustement. */
export function zoomView(view: View, factor: number, sx: number, sy: number, bounds: Bounds): View {
  const fit = fitScale(view.width, view.height, bounds);
  const scale = Math.min(fit * MAX_ZOOM, Math.max(fit * MIN_ZOOM, view.scale * factor));
  const [wx, wy] = screenToWorld(view, sx, sy);
  return {
    ...view,
    scale,
    cx: wx - (sx - view.width / 2) / scale,
    cy: wy + (sy - view.height / 2) / scale,
  };
}

export function resizeView(view: View, width: number, height: number, bounds: Bounds): View {
  if (view.width === 0 || view.height === 0) return fitView(width, height, bounds);
  // On garde le même niveau de zoom relatif lors d'un redimensionnement.
  const zoom = zoomOf(view, bounds);
  return { ...view, width, height, scale: fitScale(width, height, bounds) * zoom };
}

export function visibleWorldBounds(view: View, margin = 0): Bounds {
  const [west, north] = screenToWorld(view, -margin, -margin);
  const [east, south] = screenToWorld(view, view.width + margin, view.height + margin);
  return [west, south, east, north];
}
