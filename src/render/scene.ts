import { buildStructureBoundarySegments, buildTerritoryOverviewFromCells, type TerritoryCell, type TerritoryOverview } from "../core/geometry";
import type { TerritoryEngine } from "../core/territory";
import type { Building } from "../core/types";
import type { Scene, SceneAssets } from "./draw";
import { browserSurface, type SurfaceFactory } from "./layers";
import type { Bounds } from "./view";

export function createScene(
  engine: TerritoryEngine,
  assets: SceneAssets,
  bounds: Bounds,
  surfaces: SurfaceFactory = browserSurface
): Scene {
  return {
    engine,
    assets,
    bounds,
    surfaces,
    structureSegments: {
      territory: buildStructureBoundarySegments(engine.structures, "territoryRadiusInCells"),
      teleport: buildStructureBoundarySegments(engine.structures, "teleportRadiusInCells"),
    },
  };
}

const overviewCache = new WeakMap<readonly Building[], Map<string, TerritoryOverview>>();
/** Dernier résultat par alliance, avec une empreinte de ses cellules : un drapeau posé ne recalcule que les alliances touchées. */
const lastByAlliance = new WeakMap<TerritoryEngine, Map<string, { count: number; hash: number; overview: TerritoryOverview }>>();

/** Rectangles de territoire par alliance, recalculés seulement quand les bâtiments (et donc les cellules de l'alliance) changent. */
export function overviewsFor(engine: TerritoryEngine, buildings: readonly Building[]): Map<string, TerritoryOverview> {
  let overviews = overviewCache.get(buildings);
  if (overviews) return overviews;
  const cells = new Map<string, { cells: TerritoryCell[]; hash: number }>();
  for (const owner of engine.state(buildings).ownership.values()) {
    let g = cells.get(owner.allianceId);
    if (!g) cells.set(owner.allianceId, (g = { cells: [], hash: 0 }));
    g.cells.push(owner);
    g.hash = (g.hash + Math.imul(owner.column * 73856093 + owner.row * 19349663, 2654435761)) | 0; // somme : indépendante de l'ordre
  }
  const previous = lastByAlliance.get(engine) ?? new Map();
  const next = new Map<string, { count: number; hash: number; overview: TerritoryOverview }>();
  overviews = new Map();
  for (const [id, g] of cells) {
    const old = previous.get(id);
    const entry = old && old.count === g.cells.length && old.hash === g.hash ? old : { count: g.cells.length, hash: g.hash, overview: buildTerritoryOverviewFromCells(g.cells) };
    next.set(id, entry);
    overviews.set(id, entry.overview);
  }
  lastByAlliance.set(engine, next);
  overviewCache.set(buildings, overviews);
  return overviews;
}
