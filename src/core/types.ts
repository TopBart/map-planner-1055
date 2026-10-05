/** Types partagés. Les formats de plan et de catalogue suivent ceux du Territory Lab de ROK Battles (v2). */

export type Point = [number, number];
export type Mode = "territory" | "baulur";
export type Season = "preparation" | "season-1" | "season-2" | "season-3" | "conquest";
export type BuildingKind = "flag" | "center-fortress" | "fortress" | "horse";
export type AnnotationKind = "line" | "arrow" | "circle" | "text" | "marker";
export type Tool = "select" | "sanctuary" | "pass-level" | AnnotationKind | BuildingKind;
export type ResourceKind = "food" | "wood" | "stone" | "coin" | "crystal";
export type CostResourceKind = "credits" | "food" | "wood" | "stone" | "gold" | "crystal";
export type BuildingCost = Partial<Record<CostResourceKind, number>>;
export type BuildingCostTier = { from: number; to: number; cost: BuildingCost };
export type BuildingCostSchedule = Partial<Record<BuildingKind, BuildingCostTier[]>>;

export type StructureCollision =
  | { shape: "world-square"; halfSize: number }
  | { shape: "territory-square"; radiusInCells: number };

export type StructureRule = {
  collision: StructureCollision;
  territoryRadiusInCells: number;
  teleportRadiusInCells: number | null;
  claimable: boolean;
};

export type Structure = StructureRule & {
  id: number;
  strongholdType: number;
  kind: string;
  x: number;
  y: number;
  label: string;
};

export type MapSummary = {
  map: string;
  name: string;
  season: Season;
  order: number;
  categories: string[];
};

export type Catalog = MapSummary & {
  schemaVersion: 2;
  /** Étendue de l'image : [ouest, sud, est, nord] en unités natives (le nord est en haut). */
  bounds: [number, number, number, number];
  pixelSize: [number, number];
  assets: Record<string, { sha256: string; bytes: number }>;
  structureIcons: Record<string, string>;
  structureRules: Record<string, StructureRule>;
  buildingIcons: Record<string, string>;
  siteIcons: Record<string, string>;
  buildings: Partial<Record<BuildingKind, { limit: number }>>;
  costs: Partial<Record<BuildingKind, BuildingCostTier[]>>;
  resourceProductionPerHour: Record<string, number>;
  ruleset: "home" | "lost-land";
  nativeMapSize: number;
};

export type Alliance = { id: string; name: string; color: string };
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  points: Point[];
  color: string;
  width: number;
  text?: string;
};
/** Sanctuaire : bonus (clé), valeur (0,05 = 5 %) et position en unités internes. */
export type Sanctuary = { id: string; bonus: string; value: number; x: number; y: number };
export type Building = { id: string; kind: BuildingKind; allianceId: string; x: number; y: number };
export type Route = {
  id: string;
  name: string;
  color: string;
  commander: string;
  siteIds: string[];
  startSiteId?: string;
  passes: { siteId: string; allianceId: string }[];
};
export type Plan = {
  version: 2;
  map: string;
  mode: Mode;
  alliances: Alliance[];
  annotations: Annotation[];
  buildings: Building[];
  routes: Route[];
};

export type Site = {
  id: string;
  kind: string;
  x: number;
  y: number;
  label?: string;
  level?: number;
  strongholdType?: number;
  subType?: number;
};
export type ResourcePoint = { id: number; kind: ResourceKind; x: number; y: number };
export type MeshDefinition = { id: number; vertices: [number, number][]; indices: number[] };
export type MeshInstance = { mesh: number; affine: [number, number, number, number, number, number] };

export type ProvinceGrid = {
  cellSize: number;
  width: number;
  height: number;
  cells: Uint8Array;
  flagBlocked: ReadonlySet<number>;
  fortressBlocked: ReadonlySet<number>;
};

export type MapData = {
  sites: Site[];
  landmarks: Site[];
  resources: ResourcePoint[];
  definitions: MeshDefinition[];
  instances: MeshInstance[];
  province: ProvinceGrid | null;
};

export const PALETTE = ["#FF0000", "#FF8A00", "#FFFC00", "#00FF5A", "#00DEFF", "#0084FF", "#B400FF", "#FF4DBE"];
export const COLOR_NAMES = ["Rouge", "Orange", "Jaune", "Vert", "Cyan", "Bleu", "Violet", "Rose"];

export const SEASONS: [Season, string][] = [
  ["preparation", "Saison de préparation"],
  ["season-1", "Saison 1"],
  ["season-2", "Saison 2"],
  ["season-3", "Saison 3"],
  ["conquest", "Saison d'expédition / Conquête"],
];

export function newPlan(map: string, mode: Mode = "territory"): Plan {
  return {
    version: 2,
    map,
    mode,
    alliances: [{ id: "alliance-1", name: "ROKB", color: PALETTE[4] }],
    annotations: [],
    buildings: [],
    routes: [],
  };
}
