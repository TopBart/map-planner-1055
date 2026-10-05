import {
  buildingRules,
  type BoundarySegment,
  TERRITORY_UNIT,
  type TerritoryOverview,
  snapTerritoryPoint,
  territoryBounds,
} from "../core/geometry";
import type { TerritoryEngine } from "../core/territory";
import type { Annotation, BuildingKind, Sanctuary, Plan, Point, ResourceKind, Structure } from "../core/types";
import { PALETTE } from "../core/types";
import { bonusByKey, passKey, sanctuaryStats } from "../core/sanctuary";
import { statIcon } from "./bonusIcons";
import { browserSurface, type LayerImage, type Surface, type SurfaceFactory } from "./layers";
import { type Bounds, fitScale, type View, visibleWorldBounds, worldToScreen } from "./view";

export type Drawable = { width: number; height: number };
export type Visibility = {
  resources: boolean;
  resourceZones: boolean;
  allianceTags: boolean;
  caves: boolean;
  villages: boolean;
  forbidden: boolean;
  provinces: boolean;
  playable: boolean;
  sanctuaries: boolean;
  passLevels: boolean;
};
export const DEFAULT_VISIBILITY: Visibility = {
  resources: true,
  resourceZones: true,
  allianceTags: true,
  caves: false,
  villages: false,
  forbidden: true,
  provinces: false,
  playable: true,
  sanctuaries: true,
  passLevels: true,
};

export type SceneAssets = {
  detail?: Drawable;
  overview?: Drawable;
  sprites: Map<string, Drawable>;
  forbidden?: LayerImage | null;
  provinces?: LayerImage | null;
  /** Capture d'écran redressée, posée au-dessus de la carte pour calquer les drapeaux. */
  overlay?: LayerImage | null;
};

export type Pin = { x: number; y: number; label: string; color: string };

export type Placement = { kind: BuildingKind; allianceId: string; x: number; y: number; legal: boolean };
export type Draft = { kind: "line" | "arrow" | "circle"; points: Point[]; color: string; width: number };

export type FrameState = {
  plan: Plan;
  selected: ReadonlySet<string>;
  visibility: Visibility;
  placement?: Placement | null;
  draft?: Draft | null;
  overlayOpacity?: number;
  pins?: readonly Pin[];
  /** Sanctuaires de la carte (données de la carte, indépendantes du plan). */
  sanctuaries?: readonly Sanctuary[];
  /** Niveau des portes par position (passKey). */
  passLevels?: Readonly<Record<string, number>>;
  /** Cases (« colonne:ligne ») détectées sur la capture, affichées en surbrillance. */
  trace?: ReadonlySet<string> | null;
  exporting?: boolean;
};

export type Scene = {
  engine: TerritoryEngine;
  assets: SceneAssets;
  /** Bords de l'image, qui peuvent différer de la zone jouable (bordures décoratives). */
  bounds: Bounds;
  structureSegments: { territory: BoundarySegment[]; teleport: BoundarySegment[] };
  surfaces: SurfaceFactory;
};

const RESOURCE_COLORS: Record<ResourceKind, string> = {
  food: "#d9b24a",
  wood: "#8b5a2b",
  stone: "#9aa0a6",
  coin: "#f5c518",
  crystal: "#4fc3f7",
};
const BUILDING_LETTER: Record<BuildingKind, string> = { flag: "D", "center-fortress": "C", fortress: "F", horse: "H" };

/** Opacité maximale des zones interdites (le motif hachuré est déjà dans la couche). */
const FORBIDDEN_ALPHA = 0.55;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const labelCache = new Map<string, Surface>();

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function labelSurface(make: SurfaceFactory, text: string, color: string, size: number, selected: boolean): Surface {
  const key = `${text}|${color}|${size}|${selected}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const measure = make(8, 8).getContext("2d");
  const font = `600 ${size}px system-ui, sans-serif`;
  measure.font = font;
  const width = Math.min(4096, Math.ceil(measure.measureText(text).width) + 12);
  const surface = make(width, size + 14);
  const ctx = surface.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = selected ? "#536574" : "rgba(9,18,29,0.9)";
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 6, surface.height / 2);
  if (labelCache.size > 400) labelCache.clear();
  labelCache.set(key, surface);
  return surface;
}

function drawImageInBounds(ctx: any, image: Drawable, bounds: Bounds, view: View, alpha: number) {
  if (alpha <= 0) return;
  const [x0, y0] = worldToScreen(view, bounds[0], bounds[3]);
  const [x1, y1] = worldToScreen(view, bounds[2], bounds[1]);
  ctx.globalAlpha = alpha;
  ctx.drawImage(image as CanvasImageSource, x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1;
}

function drawSprite(
  ctx: any,
  assets: SceneAssets,
  key: string | undefined,
  sx: number,
  sy: number,
  size: number,
  fallback: (ctx: any, sx: number, sy: number, size: number) => void,
  alpha = 1
) {
  const image = key ? assets.sprites.get(key) : undefined;
  if (image) {
    const width = size * (image.width / image.height);
    ctx.globalAlpha = alpha;
    ctx.drawImage(image as CanvasImageSource, sx - width / 2, sy - size / 2, width, size);
    ctx.globalAlpha = 1;
  } else fallback(ctx, sx, sy, size);
}

function fallbackDot(color: string, letter?: string) {
  return (ctx: any, sx: number, sy: number, size: number) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, size / 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (letter && size >= 18) {
      ctx.fillStyle = "#111";
      ctx.font = `700 ${Math.round(size * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, sx, sy + 1);
      ctx.textAlign = "start";
    }
  };
}

function structureKey(engine: TerritoryEngine, structure: Structure): string | undefined {
  const { catalog } = engine;
  return structure.strongholdType ? catalog.structureIcons[String(structure.strongholdType)] : catalog.siteIcons[structure.kind];
}

function strokeSegments(ctx: any, segments: BoundarySegment[], view: View, visible: Bounds) {
  ctx.beginPath();
  for (const s of segments) {
    if (s.x2 < visible[0] || s.x1 > visible[2] || s.y2 < visible[1] || s.y1 > visible[3]) continue;
    const [ax, ay] = worldToScreen(view, s.x1, s.y1);
    const [bx, by] = worldToScreen(view, s.x2, s.y2);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
}

function drawAnnotation(ctx: any, a: Annotation, view: View, selected: boolean, make: SurfaceFactory) {
  const pts = a.points.map(([x, y]) => worldToScreen(view, x, y));
  const lineWidth = a.width * 1.5;
  const stroke = (color: string, extra: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth + extra;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  if (a.kind === "text") {
    const surface = labelSurface(make, a.text ?? "", a.color, 13 + a.width * 3, selected);
    ctx.drawImage(surface as CanvasImageSource, pts[0][0] - surface.width / 2, pts[0][1] - surface.height / 2);
    return;
  }
  if (a.kind === "marker") {
    const [x, y] = pts[0];
    const r = 6 + a.width * 1.5;
    if (selected) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(x, y - r * 2, r + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = a.color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 1.2, x - r, y - r * 3, x, y - r * 3);
    ctx.bezierCurveTo(x + r, y - r * 3, x + r * 1.5, y - r * 1.2, x, y);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y - r * 2, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (pts.length < 2) return;
  const path = () => {
    ctx.beginPath();
    if (a.kind === "circle") {
      const radius = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      ctx.arc(pts[0][0], pts[0][1], radius, 0, Math.PI * 2);
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    }
  };
  const arrowHead = () => {
    const [from, to] = [pts[pts.length - 2], pts[pts.length - 1]];
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const length = 8 + a.width * 3;
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - length * Math.cos(angle - 0.45), to[1] - length * Math.sin(angle - 0.45));
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - length * Math.cos(angle + 0.45), to[1] - length * Math.sin(angle + 0.45));
  };
  if (selected) {
    path();
    stroke("rgba(255,255,255,0.6)", 5);
    if (a.kind === "arrow") {
      arrowHead();
      stroke("rgba(255,255,255,0.6)", 5);
    }
  }
  path();
  stroke(a.color, 0);
  if (a.kind === "arrow") {
    arrowHead();
    stroke(a.color, 0);
  }
}

/** Dessine une image complète. Aucune allocation lourde : les couches coûteuses sont pré-rendues. */
/** `phase` : "base" = fond + bâtiments + annotations ; "overlay" = aperçus interactifs et repères ; "all" = tout. */
export function drawScene(ctx: any, scene: Scene, state: FrameState, view: View, overviews: Map<string, TerritoryOverview>, phase: "all" | "base" | "overlay" = "all") {
  const { engine, assets, bounds } = scene;
  const { catalog } = engine;
  const { plan, visibility, exporting } = state;
  const zoom = view.scale / fitScale(view.width, view.height, bounds);
  const detail = exporting ? 1 : clamp01(zoom - 1);
  const visible = visibleWorldBounds(view, 40);
  const inView = (x: number, y: number) => x >= visible[0] && x <= visible[2] && y >= visible[1] && y <= visible[3];

  ctx.save();
  if (phase !== "overlay") {
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // 1. Carte : l'aperçu seul de loin, l'image détaillée en fondu entre 1× et 2×.
  if (assets.overview) drawImageInBounds(ctx, assets.overview, bounds, view, 1);
  if (assets.detail) drawImageInBounds(ctx, assets.detail, bounds, view, assets.overview ? detail : 1);
  if (!assets.overview && !assets.detail) {
    const [x0, y0] = worldToScreen(view, bounds[0], bounds[3]);
    const [x1, y1] = worldToScreen(view, bounds[2], bounds[1]);
    ctx.fillStyle = "#3b4a2a";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  if (assets.overlay && !exporting && (state.overlayOpacity ?? 0) > 0)
    drawImageInBounds(ctx, assets.overlay.surface, assets.overlay.bounds, view, state.overlayOpacity ?? 0);

  // 2. Bordures : tout ce qui est hors de la zone jouable est assombri.
  const size = catalog.nativeMapSize;
  const [px0, py0] = worldToScreen(view, 0, size);
  const [px1, py1] = worldToScreen(view, size, 0);
  if (visibility.playable && !exporting) {
    const [ix0, iy0] = worldToScreen(view, bounds[0], bounds[3]);
    const [ix1, iy1] = worldToScreen(view, bounds[2], bounds[1]);
    ctx.fillStyle = "rgba(9,9,11,0.55)";
    ctx.beginPath();
    ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.fill("evenodd");
  }

  // 3. Zones où l'on ne peut pas construire.
  if (visibility.forbidden && assets.forbidden && detail > 0)
    drawImageInBounds(ctx, assets.forbidden.surface, assets.forbidden.bounds, view, FORBIDDEN_ALPHA * detail);
  if (visibility.provinces && assets.provinces) {
    ctx.imageSmoothingEnabled = false;
    drawImageInBounds(ctx, assets.provinces.surface, assets.provinces.bounds, view, 0.28);
    ctx.imageSmoothingEnabled = true;
  }

  const mode = plan.mode;
  if (mode === "territory") {
    // 4. Contours du territoire des structures (zone de téléportation en plus fin).
    if (detail > 0) {
      ctx.globalAlpha = detail;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(39,39,42,0.45)";
      ctx.lineWidth = 1;
      strokeSegments(ctx, scene.structureSegments.teleport, view, visible);
      ctx.strokeStyle = "rgba(39,39,42,0.78)";
      ctx.lineWidth = 1.6;
      strokeSegments(ctx, scene.structureSegments.territory, view, visible);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 5. Territoire de chaque alliance.
    for (const alliance of plan.alliances) {
      const overview = overviews.get(alliance.id);
      if (!overview) continue;
      ctx.fillStyle = rgba(alliance.color, 0.28);
      ctx.beginPath();
      for (const r of overview.fillRects) {
        if (r.maxX < visible[0] || r.minX > visible[2] || r.maxY < visible[1] || r.minY > visible[3]) continue;
        const [x0, y0] = worldToScreen(view, r.minX, r.maxY);
        const [x1, y1] = worldToScreen(view, r.maxX, r.minY);
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
      }
      ctx.fill();
    }
  }

  if (state.trace && state.trace.size && !exporting) {
    ctx.fillStyle = "rgba(255,0,200,0.45)";
    ctx.beginPath();
    for (const key of state.trace) {
      const [col, row] = key.split(":").map(Number);
      const x = col * TERRITORY_UNIT;
      const y = row * TERRITORY_UNIT;
      if (x + TERRITORY_UNIT < visible[0] || x > visible[2] || y + TERRITORY_UNIT < visible[1] || y > visible[3]) continue;
      const [x0, y0] = worldToScreen(view, x, y + TERRITORY_UNIT);
      const [x1, y1] = worldToScreen(view, x + TERRITORY_UNIT, y);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.fill();
  }

  // 6. Structures de la carte.
  for (const structure of engine.structures) {
    if (!inView(structure.x, structure.y)) continue;
    const [sx, sy] = worldToScreen(view, structure.x, structure.y);
    const size = structure.kind === "pass" ? 22 : 28;
    drawSprite(ctx, assets, structureKey(engine, structure), sx, sy, size, fallbackDot("#cfcfd4", "S"), 0.92);
  }

  // 7. Ressources : hit box à l'échelle réelle (rayon du puits) et icône, jamais plus petite qu'un minimum lisible.
  // À l'export le minimum suit la largeur de l'image, pour que les ressources restent visibles sur le PNG final.
  if (visibility.resources && mode === "territory" && (exporting || zoom >= 3)) {
    const radius = engine.resourceRadius;
    const floor = exporting ? Math.max(12, view.width / 250) : 14;
    const iconSize = Math.max(floor, 2 * radius * view.scale);
    const zones = visibility.resourceZones && radius * view.scale >= 3;
    if (zones) {
      ctx.strokeStyle = "rgba(239,68,68,0.95)";
      ctx.fillStyle = "rgba(239,68,68,0.15)";
      ctx.lineWidth = exporting ? Math.max(1.5, view.width / 1500) : 1.4;
    }
    for (const r of engine.data.resources) {
      if (!inView(r.x, r.y)) continue;
      const [sx, sy] = worldToScreen(view, r.x, r.y);
      if (zones) {
        ctx.beginPath();
        ctx.arc(sx, sy, radius * view.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      drawSprite(ctx, assets, catalog.siteIcons[r.kind], sx, sy, iconSize, fallbackDot(RESOURCE_COLORS[r.kind]));
    }
  }
  if (mode === "territory" && detail > 0) {
    ctx.globalAlpha = detail;
    for (const l of engine.data.landmarks) {
      if (!(l.kind === "cave" ? visibility.caves : visibility.villages) || !inView(l.x, l.y)) continue;
      const [sx, sy] = worldToScreen(view, l.x, l.y);
      drawSprite(ctx, assets, catalog.siteIcons[l.kind], sx, sy, 20, fallbackDot(l.kind === "cave" ? "#7c6f64" : "#c08457"));
    }
    ctx.globalAlpha = 1;
  }

  // 8. Bâtiments.
  for (const b of plan.buildings) {
    const flag = b.kind === "flag";
    if (flag && zoom < 5) continue;
    if (!inView(b.x, b.y)) continue;
    const alliance = plan.alliances.find((a) => a.id === b.allianceId);
    const color = alliance?.color ?? PALETTE[4];
    const [sx, sy] = worldToScreen(view, b.x, b.y);
    if (zoom >= 10 && b.kind !== "horse") {
      const t = territoryBounds(b);
      const [x0, y0] = worldToScreen(view, t.minX, t.maxY);
      const [x1, y1] = worldToScreen(view, t.maxX, t.minY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (!exporting && state.selected.has(b.id)) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(sx - 15, sy - 15, 30, 30);
    }
    drawSprite(
      ctx,
      assets,
      catalog.buildingIcons[b.kind],
      sx,
      sy,
      flag ? 24 : 30,
      fallbackDot(color, BUILDING_LETTER[b.kind])
    );
    if (!flag && visibility.allianceTags && alliance) {
      const label = labelSurface(scene.surfaces, alliance.name, alliance.color, 13, false);
      ctx.drawImage(label as CanvasImageSource, sx - label.width / 2, sy - 28 - label.height / 2);
    }
  }

  // 8b. Sanctuaires : icône(s) du bonus (une ou deux), ou pastille colorée tant que les icônes ne sont pas chargées.
  if (visibility.sanctuaries && state.sanctuaries?.length) {
    const size = exporting ? Math.max(15, view.width / 150) : 15;
    for (const sc of state.sanctuaries) {
      if (!inView(sc.x, sc.y)) continue;
      const def = bonusByKey(sc.bonus);
      const parts = sanctuaryStats(sc);
      const [sx, sy] = worldToScreen(view, sc.x, sc.y);
      const selected = !exporting && state.selected.has(sc.id);
      const n = Math.max(1, parts.length);
      const icon = size * (n > 1 ? 1.5 : 1.75);
      const step = size * 0.85;
      parts.forEach((part, i) => {
        const cx = sx + (i - (n - 1) / 2) * step;
        const img = statIcon(part.stat);
        if (img) {
          ctx.drawImage(img as CanvasImageSource, cx - icon / 2, sy - icon / 2, icon, icon);
        } else {
          ctx.fillStyle = def?.color ?? "#777";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, sy, size * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = `700 ${Math.round(size * 0.55)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText((def?.short ?? "?").slice(i, i + 1) || "?", cx, sy + 0.5);
        }
      });
      if (selected) {
        ctx.strokeStyle = "#ffeb3b";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - (n * step) / 2 - 2, sy - icon / 2 - 2, n * step + 4, icon + 4);
      }
      if (zoom >= 6 || exporting) {
        const text = parts.map((q) => `+${Math.round(q.value * 1000) / 10}%`).join(" / ");
        const label = labelSurface(scene.surfaces, text, def?.color ?? "#777", Math.round(size * 0.7), false);
        ctx.drawImage(label as CanvasImageSource, sx - label.width / 2, sy + icon / 2 + 1);
      }
    }
  }

  // 8c. Niveau des portes : pastille « N » à côté de la structure.
  if (visibility.passLevels && state.passLevels) {
    const size = exporting ? Math.max(15, view.width / 150) : 15;
    for (const st of scene.engine.structures) {
      const level = state.passLevels[passKey(st.x, st.y)];
      if (!level || !inView(st.x, st.y)) continue;
      const [sx, sy] = worldToScreen(view, st.x, st.y);
      const bx = sx + size * 0.9, by = sy - size * 0.9;
      ctx.fillStyle = "#1b1f2a";
      ctx.strokeStyle = "#ffd54a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, size * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd54a";
      ctx.font = `800 ${Math.round(size * 0.75)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(level), bx, by + 0.5);
    }
  }

  // 9. Annotations.
  if (mode === "territory")
    for (const a of plan.annotations) drawAnnotation(ctx, a, view, !exporting && state.selected.has(a.id), scene.surfaces);

  // 11. Limite de la zone jouable.
  if (visibility.playable && !exporting) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
    ctx.setLineDash([]);
  }
  }
  if (phase !== "base" && !exporting) {
  // 10. Aperçus interactifs (jamais dans l'export).
  {
    if (state.placement) drawPlacement(ctx, state.placement, view);
    if (state.draft && state.draft.points.length >= 2)
      drawAnnotation(ctx, { id: "draft", kind: state.draft.kind, points: state.draft.points, color: state.draft.color, width: state.draft.width }, view, false, scene.surfaces);
  }

  if (state.pins && !exporting) {
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const pin of state.pins) {
      const [px, py] = worldToScreen(view, pin.x, pin.y);
      ctx.fillStyle = pin.color;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.fillText(pin.label, px, py + 0.5);
    }
  }

  }
  ctx.restore();
}

function drawPlacement(ctx: any, placement: Placement, view: View) {
  const { kind, x, y, legal } = placement;
  const color = legal ? "#22C55E" : "#EF4444";
  const bounds = territoryBounds({ kind, x, y });
  const [x0, y0] = worldToScreen(view, bounds.minX, bounds.maxY);
  const [x1, y1] = worldToScreen(view, bounds.maxX, bounds.minY);
  ctx.fillStyle = rgba(color, 0.22);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
  const cell = snapTerritoryPoint(x, y);
  const [c0x, c0y] = worldToScreen(view, cell.x - TERRITORY_UNIT / 2, cell.y + TERRITORY_UNIT / 2);
  const [c1x, c1y] = worldToScreen(view, cell.x + TERRITORY_UNIT / 2, cell.y - TERRITORY_UNIT / 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(c0x, c0y, c1x - c0x, c1y - c0y);
  const clearance = buildingRules[kind].baseClearance;
  const [b0x, b0y] = worldToScreen(view, x - clearance, y + clearance);
  const [b1x, b1y] = worldToScreen(view, x + clearance, y - clearance);
  ctx.strokeStyle = color;
  ctx.strokeRect(b0x, b0y, b1x - b0x, b1y - b0y);
  const [sx, sy] = worldToScreen(view, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(sx - 9, sy - 1, 18, 2);
  ctx.fillRect(sx - 1, sy - 9, 2, 18);
  ctx.fillStyle = color;
  ctx.fillRect(sx - 2, sy - 2, 4, 4);
}

/** Dernier réglage : surface de rendu pour l'export à pleine résolution. */
export function renderToSurface(
  scene: Scene,
  state: FrameState,
  width: number,
  height: number,
  overviews: Map<string, TerritoryOverview>,
  make: SurfaceFactory = browserSurface
): Surface {
  const surface = make(width, height);
  const ctx = surface.getContext("2d");
  const scale = fitScale(width, height, scene.bounds) / 0.94;
  const view: View = {
    cx: (scene.bounds[0] + scene.bounds[2]) / 2,
    cy: (scene.bounds[1] + scene.bounds[3]) / 2,
    scale,
    width,
    height,
  };
  drawScene(ctx, scene, { ...state, exporting: true, placement: null, draft: null }, view, overviews);
  return surface;
}
