/**
 * Règles de territoire : cellules, propriété, connexité, collisions.
 * Port du module `lib/territory/geometry.ts` de ROK Battles (Apache-2.0 / MIT).
 */
import type { Building, BuildingKind, ProvinceGrid, ResourceKind, ResourcePoint, Structure } from "./types";

export const TERRITORY_UNIT = 18;

export const buildingRules: Record<BuildingKind, { territorySide: number; baseClearance: number; root: boolean }> = {
  flag: { territorySide: 54, baseClearance: 1.4, root: false },
  "center-fortress": { territorySide: 90, baseClearance: 3.75, root: true },
  fortress: { territorySide: 90, baseClearance: 3, root: true },
  horse: { territorySide: 54, baseClearance: 3, root: true },
};

export type TerritoryCell = { column: number; row: number };
export type TerritoryCellOwner = TerritoryCell & { allianceId: string };
export type TerritoryOwnership = ReadonlyMap<string, TerritoryCellOwner>;
export type TerritoryState = { ownership: TerritoryOwnership; structureOwners: ReadonlyMap<number, string> };
export type FillRect = { minX: number; minY: number; maxX: number; maxY: number };
export type BoundarySegment = { x1: number; y1: number; x2: number; y2: number };
export type TerritoryOverview = { fillRects: FillRect[]; boundarySegments: BoundarySegment[] };

export const cellKey = (column: number, row: number) => `${column}:${row}`;

export function snapTerritoryCoordinate(value: number): number {
  return Math.floor(value / TERRITORY_UNIT) * TERRITORY_UNIT + TERRITORY_UNIT / 2;
}

export function snapTerritoryPoint(x: number, y: number) {
  return { x: snapTerritoryCoordinate(x), y: snapTerritoryCoordinate(y) };
}

export function provinceIdAt(grid: ProvinceGrid | null, x: number, y: number): number | null {
  if (!grid || x < 0 || y < 0) return null;
  const column = Math.floor(x / grid.cellSize);
  const row = Math.floor(y / grid.cellSize);
  if (column >= grid.width || row >= grid.height) return null;
  return grid.cells[row * grid.width + column] ?? null;
}

export function isProvinceRestricted(grid: ProvinceGrid | null, kind: BuildingKind, x: number, y: number): boolean {
  const id = provinceIdAt(grid, x, y);
  if (id === null || !grid) return false;
  return kind === "flag" ? grid.flagBlocked.has(id) : grid.fortressBlocked.has(id);
}

export function territoryBounds(building: Pick<Building, "kind" | "x" | "y">): FillRect {
  const center = snapTerritoryPoint(building.x, building.y);
  const half = buildingRules[building.kind].territorySide / 2;
  return { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
}

export function structureTerritoryCells(
  structure: Pick<Structure, "x" | "y" | "territoryRadiusInCells">
): TerritoryCell[] {
  const centerColumn = Math.floor(structure.x / TERRITORY_UNIT);
  const centerRow = Math.floor(structure.y / TERRITORY_UNIT);
  const radius = structure.territoryRadiusInCells;
  const cells: TerritoryCell[] = [];
  for (let row = centerRow - radius; row <= centerRow + radius; row++)
    for (let column = centerColumn - radius; column <= centerColumn + radius; column++)
      cells.push({ column, row });
  return cells;
}

export function territoryCells(building: Pick<Building, "kind" | "x" | "y">): TerritoryCell[] {
  const centerColumn = Math.floor(building.x / TERRITORY_UNIT);
  const centerRow = Math.floor(building.y / TERRITORY_UNIT);
  const radius = (buildingRules[building.kind].territorySide / TERRITORY_UNIT - 1) / 2;
  const cells: TerritoryCell[] = [];
  for (let row = centerRow - radius; row <= centerRow + radius; row++)
    for (let column = centerColumn - radius; column <= centerColumn + radius; column++)
      cells.push({ column, row });
  return cells;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function cellsTouchAlliance(cells: TerritoryCell[], allianceId: string, ownership: TerritoryOwnership): boolean {
  return cells.some((cell) =>
    NEIGHBOR_OFFSETS.some(
      ([dc, dr]) => ownership.get(cellKey(cell.column + dc, cell.row + dr))?.allianceId === allianceId
    )
  );
}

/** Données dérivées des structures de la carte, calculées une fois par jeu de structures. */
interface StructureContext {
  cellsById: Map<number, TerritoryCell[]>;
  reserved: Set<string>;
  permanentlyExcluded: Set<string>;
  claimable: Structure[];
  /** Index spatial (seaux de BUCKET cases) des structures annexables. */
  buckets: Map<number, Structure[]>;
  maxRadius: number;
}
const BUCKET = 16;
const bucketKey = (bc: number, br: number) => bc * 4099 + br;
const contexts = new WeakMap<readonly Structure[], StructureContext>();

function structureContext(structures: readonly Structure[]): StructureContext {
  let ctx = contexts.get(structures);
  if (ctx) return ctx;
  const cellsById = new Map<number, TerritoryCell[]>();
  const reserved = new Set<string>();
  const permanentlyExcluded = new Set<string>();
  for (const structure of structures) {
    if (structure.territoryRadiusInCells <= 0) continue;
    const cells = structureTerritoryCells(structure);
    cellsById.set(structure.id, cells);
    for (const cell of cells) {
      const key = cellKey(cell.column, cell.row);
      reserved.add(key);
      if (!structure.claimable) permanentlyExcluded.add(key);
    }
  }
  const claimable = structures.filter((st) => st.claimable && st.territoryRadiusInCells > 0).sort((a, b) => a.id - b.id);
  const buckets = new Map<number, Structure[]>();
  let maxRadius = 0;
  for (const st of claimable) {
    maxRadius = Math.max(maxRadius, st.territoryRadiusInCells);
    const k = bucketKey(Math.floor(Math.floor(st.x / TERRITORY_UNIT) / BUCKET), Math.floor(Math.floor(st.y / TERRITORY_UNIT) / BUCKET));
    const list = buckets.get(k);
    if (list) list.push(st);
    else buckets.set(k, [st]);
  }
  ctx = { cellsById, reserved, permanentlyExcluded, claimable, buckets, maxRadius };
  contexts.set(structures, ctx);
  return ctx;
}

/** Structures annexables susceptibles de toucher la zone de cases [c0..c1] × [r0..r1] (marge incluse). */
function structuresNear(ctx: StructureContext, c0: number, c1: number, r0: number, r1: number): Structure[] {
  const m = ctx.maxRadius + 1;
  const out: Structure[] = [];
  for (let br = Math.floor((r0 - m) / BUCKET); br <= Math.floor((r1 + m) / BUCKET); br++)
    for (let bc = Math.floor((c0 - m) / BUCKET); bc <= Math.floor((c1 + m) / BUCKET); bc++) {
      const list = ctx.buckets.get(bucketKey(bc, br));
      if (list) out.push(...list);
    }
  return out;
}

/** Ajoute un bâtiment à l'état (modifie `state`). Les annexions de structures sont un point fixe : l'ordre n'a pas d'effet. */
function applyBuilding(state: { ownership: Map<string, TerritoryCellOwner>; structureOwners: Map<number, string> }, building: Building, ctx: StructureContext): void {
  const { ownership, structureOwners } = state;
  const cells = territoryCells(building);
  for (const cell of cells) {
    const key = cellKey(cell.column, cell.row);
    if (ctx.reserved.has(key) || ownership.has(key)) continue;
    ownership.set(key, { ...cell, allianceId: building.allianceId });
  }
  if (!ctx.claimable.length) return;
  // Zones à examiner : d'abord l'emprise du bâtiment, puis celle de chaque structure annexée.
  const queue: Array<[number, number, number, number]> = [
    [cells[0].column, cells[cells.length - 1].column, cells[0].row, cells[cells.length - 1].row],
  ];
  while (queue.length) {
    const [c0, c1, r0, r1] = queue.pop()!;
    for (const structure of structuresNear(ctx, c0, c1, r0, r1)) {
      if (structureOwners.has(structure.id)) continue;
      const sc = ctx.cellsById.get(structure.id) ?? [];
      if (!cellsTouchAlliance(sc, building.allianceId, ownership)) continue;
      structureOwners.set(structure.id, building.allianceId);
      for (const cell of sc) {
        const key = cellKey(cell.column, cell.row);
        if (ctx.permanentlyExcluded.has(key)) continue;
        if (!ownership.has(key)) ownership.set(key, { ...cell, allianceId: building.allianceId });
      }
      queue.push([sc[0].column, sc[sc.length - 1].column, sc[0].row, sc[sc.length - 1].row]);
    }
  }
}

/** Propriété des cellules : le premier bâtiment posé garde la cellule, les structures voisines sont annexées. */
export function buildTerritoryState(
  buildings: readonly Building[],
  structures: readonly Structure[] = [],
  /** État déjà calculé pour les `from` premiers bâtiments (jamais modifié : copié). */
  base?: { state: TerritoryState; from: number }
): TerritoryState {
  const ctx = structureContext(structures);
  const state = base
    ? { ownership: new Map(base.state.ownership), structureOwners: new Map(base.state.structureOwners) }
    : { ownership: new Map<string, TerritoryCellOwner>(), structureOwners: new Map<number, string>() };
  for (let i = base?.from ?? 0; i < buildings.length; i++) applyBuilding(state, buildings[i], ctx);
  return state;
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

/** Fusionne des cellules en rectangles pleins et en segments de contour. */
export function buildTerritoryOverviewFromCells(source: Iterable<TerritoryCell>): TerritoryOverview {
  const cells = new Map<string, TerritoryCell>();
  for (const cell of source) cells.set(cellKey(cell.column, cell.row), cell);

  const columnsByRow = new Map<number, number[]>();
  for (const { column, row } of cells.values()) {
    const columns = columnsByRow.get(row);
    if (columns) columns.push(column);
    else columnsByRow.set(row, [column]);
  }

  const fillRects: FillRect[] = [];
  let activeRects = new Map<string, FillRect>();
  for (const row of [...columnsByRow.keys()].sort((a, b) => a - b)) {
    const columns = (columnsByRow.get(row) ?? []).sort((a, b) => a - b);
    const spans: Array<[number, number]> = [];
    for (const column of columns) {
      const previous = spans.at(-1);
      if (previous && column === previous[1]) previous[1] = column + 1;
      else spans.push([column, column + 1]);
    }
    const nextActive = new Map<string, FillRect>();
    for (const [minColumn, maxColumn] of spans) {
      const key = `${minColumn}:${maxColumn}`;
      const minY = row * TERRITORY_UNIT;
      const active = activeRects.get(key);
      if (active && active.maxY === minY) {
        active.maxY += TERRITORY_UNIT;
        nextActive.set(key, active);
      } else {
        const rect = {
          minX: minColumn * TERRITORY_UNIT,
          minY,
          maxX: maxColumn * TERRITORY_UNIT,
          maxY: minY + TERRITORY_UNIT,
        };
        fillRects.push(rect);
        nextActive.set(key, rect);
      }
    }
    activeRects = nextActive;
  }

  const horizontal = new Map<number, Array<[number, number]>>();
  const vertical = new Map<number, Array<[number, number]>>();
  const add = (groups: Map<number, Array<[number, number]>>, axis: number, start: number, end: number) => {
    const list = groups.get(axis);
    if (list) list.push([start, end]);
    else groups.set(axis, [[start, end]]);
  };
  for (const { column, row } of cells.values()) {
    const minX = column * TERRITORY_UNIT;
    const minY = row * TERRITORY_UNIT;
    const maxX = minX + TERRITORY_UNIT;
    const maxY = minY + TERRITORY_UNIT;
    if (!cells.has(cellKey(column, row - 1))) add(horizontal, minY, minX, maxX);
    if (!cells.has(cellKey(column, row + 1))) add(horizontal, maxY, minX, maxX);
    if (!cells.has(cellKey(column - 1, row))) add(vertical, minX, minY, maxY);
    if (!cells.has(cellKey(column + 1, row))) add(vertical, maxX, minY, maxY);
  }
  const boundarySegments: BoundarySegment[] = [];
  for (const y of [...horizontal.keys()].sort((a, b) => a - b))
    for (const [x1, x2] of mergeIntervals(horizontal.get(y) ?? [])) boundarySegments.push({ x1, y1: y, x2, y2: y });
  for (const x of [...vertical.keys()].sort((a, b) => a - b))
    for (const [y1, y2] of mergeIntervals(vertical.get(x) ?? [])) boundarySegments.push({ x1: x, y1, x2: x, y2 });
  return { fillRects, boundarySegments };
}

export function buildStructureBoundarySegments(
  structures: readonly Structure[],
  radiusKey: "territoryRadiusInCells" | "teleportRadiusInCells"
): BoundarySegment[] {
  const cells = structures.flatMap((structure) => {
    const radius = structure[radiusKey];
    if (radius === null) return [];
    return structureTerritoryCells({ ...structure, territoryRadiusInCells: radius });
  });
  return buildTerritoryOverviewFromCells(cells).boundarySegments;
}

export function buildTerritoryOverviewsFromOwnership(ownership: TerritoryOwnership): Map<string, TerritoryOverview> {
  const byAlliance = new Map<string, TerritoryCell[]>();
  for (const owner of ownership.values()) {
    const list = byAlliance.get(owner.allianceId);
    if (list) list.push(owner);
    else byAlliance.set(owner.allianceId, [owner]);
  }
  return new Map([...byAlliance].map(([id, cells]) => [id, buildTerritoryOverviewFromCells(cells)]));
}

export function isConnectedToAlliance(
  candidate: Pick<Building, "kind" | "x" | "y" | "allianceId">,
  ownership: TerritoryOwnership
): boolean {
  if (buildingRules[candidate.kind].root) return true;
  return territoryCells(candidate).some((cell) =>
    NEIGHBOR_OFFSETS.some(
      ([dc, dr]) => ownership.get(cellKey(cell.column + dc, cell.row + dr))?.allianceId === candidate.allianceId
    )
  );
}

export function hasRequiredTerritoryAvailability(
  candidate: Pick<Building, "kind" | "x" | "y" | "allianceId">,
  ownership: TerritoryOwnership
): boolean {
  const side = Math.round(buildingRules[candidate.kind].territorySide / TERRITORY_UNIT);
  const required = Math.ceil(side / 2) * side;
  let available = 0;
  for (const cell of territoryCells(candidate)) {
    const owner = ownership.get(cellKey(cell.column, cell.row));
    if (!owner || owner.allianceId === candidate.allianceId) available += 1;
  }
  return available >= required;
}

export function plannedBuildingCollision(
  candidate: Pick<Building, "kind" | "x" | "y">,
  buildings: readonly Pick<Building, "kind" | "x" | "y">[]
): boolean {
  const radius = buildingRules[candidate.kind].baseClearance;
  return buildings.some(
    (b) => Math.hypot(candidate.x - b.x, candidate.y - b.y) < radius + buildingRules[b.kind].baseClearance
  );
}

export function circleIntersectsRectangle(
  x: number,
  y: number,
  radius: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  const nearestX = Math.max(minX, Math.min(maxX, x));
  const nearestY = Math.max(minY, Math.min(maxY, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

export function mapStructureCollision(
  candidate: Pick<Building, "kind" | "x" | "y">,
  structures: readonly Structure[]
): Structure | null {
  const radius = buildingRules[candidate.kind].baseClearance;
  for (const structure of structures) {
    if (structure.collision.shape === "world-square") {
      const half = structure.collision.halfSize;
      if (
        circleIntersectsRectangle(
          candidate.x,
          candidate.y,
          radius,
          structure.x - half,
          structure.y - half,
          structure.x + half,
          structure.y + half
        )
      )
        return structure;
      continue;
    }
    const half = ((structure.collision.radiusInCells * 2 + 1) * TERRITORY_UNIT) / 2;
    const cx = snapTerritoryCoordinate(structure.x);
    const cy = snapTerritoryCoordinate(structure.y);
    if (circleIntersectsRectangle(candidate.x, candidate.y, radius, cx - half, cy - half, cx + half, cy + half))
      return structure;
  }
  return null;
}

function pointInTriangle(x: number, y: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const first = (x - bx) * (ay - by) - (y - by) * (ax - bx);
  const second = (x - cx) * (by - cy) - (y - cy) * (bx - cx);
  const third = (x - ax) * (cy - ay) - (y - ay) * (cx - ax);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}

function segmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
}

export function circleIntersectsTriangle(
  x: number,
  y: number,
  radius: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  if (pointInTriangle(x, y, ax, ay, bx, by, cx, cy)) return true;
  const r2 = radius * radius;
  return (
    segmentDistanceSquared(x, y, ax, ay, bx, by) <= r2 ||
    segmentDistanceSquared(x, y, bx, by, cx, cy) <= r2 ||
    segmentDistanceSquared(x, y, cx, cy, ax, ay) <= r2
  );
}

export type ResourceCounts = Record<ResourceKind, number>;
export const emptyCounts = (): ResourceCounts => ({ food: 0, wood: 0, stone: 0, coin: 0, crystal: 0 });

export function countCoveredResources(
  ownership: TerritoryOwnership,
  resources: readonly ResourcePoint[],
  allianceId: string
): ResourceCounts {
  const counts = emptyCounts();
  const seen = new Set<number>();
  for (const resource of resources) {
    if (seen.has(resource.id)) continue;
    const owner = ownership.get(
      cellKey(Math.floor(resource.x / TERRITORY_UNIT), Math.floor(resource.y / TERRITORY_UNIT))
    );
    if (owner?.allianceId === allianceId) {
      seen.add(resource.id);
      counts[resource.kind] += 1;
    }
  }
  return counts;
}

export function countResourcesCoveredByBuilding(
  ownership: TerritoryOwnership,
  building: Building,
  resources: readonly ResourcePoint[]
): ResourceCounts {
  const counts = emptyCounts();
  const covered = new Set(territoryCells(building).map((c) => cellKey(c.column, c.row)));
  const seen = new Set<number>();
  for (const resource of resources) {
    if (seen.has(resource.id)) continue;
    const key = cellKey(Math.floor(resource.x / TERRITORY_UNIT), Math.floor(resource.y / TERRITORY_UNIT));
    if (covered.has(key) && ownership.get(key)?.allianceId === building.allianceId) {
      seen.add(resource.id);
      counts[resource.kind] += 1;
    }
  }
  return counts;
}
