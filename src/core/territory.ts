import { t } from "./i18n";
import { buildingCostBreakdown, calculateCostTotals } from "./costs";
import {
  buildingRules,
  buildTerritoryState,
  cellKey,
  emptyCounts,
  hasRequiredTerritoryAvailability,
  isConnectedToAlliance,
  isProvinceRestricted,
  mapStructureCollision,
  plannedBuildingCollision,
  TERRITORY_UNIT,
  type TerritoryState,
} from "./geometry";
import { TriangleIndex } from "./spatial";
import type { Building, Catalog, MapData, Plan, ResourcePoint, Structure } from "./types";

/** Structures de la carte avec leurs règles de territoire (reconstruit comme le site, v2). */
export function mapStructures(catalog: Catalog, data: MapData): Structure[] {
  return data.sites.flatMap((site, index) => {
    if (site.id.startsWith("canyons:")) return [];
    const rule =
      site.kind === "bastion"
        ? {
            collision: { shape: "territory-square" as const, radiusInCells: 1 },
            territoryRadiusInCells: 1,
            teleportRadiusInCells: null,
            claimable: false,
          }
        : catalog.structureRules?.[String(site.strongholdType)];
    if (!rule) return [];
    return [
      {
        ...rule,
        teleportRadiusInCells: rule.teleportRadiusInCells ?? null,
        id: index + 1,
        strongholdType: site.strongholdType ?? 0,
        kind: site.kind,
        x: site.x,
        y: site.y,
        label: site.label ?? "Bastion",
      },
    ];
  });
}

/**
 * Règles de placement et récapitulatifs pour une carte. Tout ce qui est coûteux
 * (index des zones interdites, propriété des cellules) est calculé une fois et mémorisé.
 */
/**
 * Rayon (unités internes) de la hit box d'un puits de ressource. Mesuré sur une capture où le grand cercle du puits
 * fait 1,46 fois le cercle d'un drapeau (rayon 1,4) : 1,4 × 1,46 ≈ 2,04. Réglable dans l'éditeur.
 */
export const DEFAULT_RESOURCE_RADIUS = 2.04;

/** Grille de hachage pour savoir en O(1) si un point se trouve près d'un cercle. */
class PointGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    private readonly points: readonly { x: number; y: number }[],
    private readonly cell = 64
  ) {
    points.forEach((p, i) => {
      const key = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }
  private key(cx: number, cy: number) {
    return cx * 100003 + cy;
  }
  anyWithin(x: number, y: number, radius: number): boolean {
    const c = this.cell;
    for (let cy = Math.floor((y - radius) / c); cy <= Math.floor((y + radius) / c); cy++)
      for (let cx = Math.floor((x - radius) / c); cx <= Math.floor((x + radius) / c); cx++)
        for (const i of this.cells.get(this.key(cx, cy)) ?? []) {
          const p = this.points[i];
          if ((p.x - x) ** 2 + (p.y - y) ** 2 < radius * radius) return true;
        }
    return false;
  }
}

const isFortress = (kind: string) => kind === "fortress" || kind === "center-fortress";

export class TerritoryEngine {
  resourceRadius = DEFAULT_RESOURCE_RADIUS;
  private readonly resourceGrid: PointGrid;
  readonly structures: Structure[];
  readonly forbidden: TriangleIndex;
  private readonly states = new WeakMap<readonly Building[], TerritoryState>();

  constructor(
    readonly catalog: Catalog,
    readonly data: MapData
  ) {
    this.structures = mapStructures(catalog, data);
    this.forbidden = new TriangleIndex(data.definitions, data.instances);
    this.resourceGrid = new PointGrid(data.resources);
  }

  /** Dernière liste calculée : une pose de bâtiment n'ajoute qu'un élément, on ne recalcule que celui-ci. */
  private last: { buildings: readonly Building[]; state: TerritoryState } | null = null;

  state(buildings: readonly Building[]): TerritoryState {
    let state = this.states.get(buildings);
    if (!state) {
      const prev = this.last;
      const extends_ = prev && buildings.length > prev.buildings.length && prev.buildings.every((b, i) => buildings[i] === b);
      state = buildTerritoryState(buildings, this.structures, extends_ ? { state: prev.state, from: prev.buildings.length } : undefined);
      this.states.set(buildings, state);
      this.last = { buildings, state };
    }
    return state;
  }

  /** Message d'erreur si le bâtiment ne peut pas être posé, sinon null. */
  placementError(candidate: Building, plan: Plan): string | null {
    const { catalog, data } = this;
    const limit = catalog.buildings[candidate.kind]?.limit ?? 0;
    if (plan.buildings.filter((b) => b.kind === candidate.kind && b.allianceId === candidate.allianceId).length >= limit)
      return t("Cette alliance a atteint la limite de ce bâtiment.");
    const radius = buildingRules[candidate.kind].baseClearance;
    const size = catalog.nativeMapSize;
    if (candidate.x - radius < 0 || candidate.y - radius < 0 || candidate.x + radius > size || candidate.y + radius > size)
      return t("Placez le bâtiment à l'intérieur de la zone jouable.");
    if (isProvinceRestricted(data.province, candidate.kind, candidate.x, candidate.y))
      return t("Cette province n'autorise pas ce bâtiment.");
    if (plannedBuildingCollision(candidate, plan.buildings)) return t("Un autre bâtiment occupe cet emplacement.");
    if (isFortress(candidate.kind)) {
      const span = (buildingRules[candidate.kind].territorySide / TERRITORY_UNIT - 1) / 2;
      const col = Math.floor(candidate.x / TERRITORY_UNIT), row = Math.floor(candidate.y / TERRITORY_UNIT);
      for (const b of plan.buildings) {
        if (!isFortress(b.kind)) continue; // le territoire des drapeaux ne compte pas
        const reach = span + (buildingRules[b.kind].territorySide / TERRITORY_UNIT - 1) / 2;
        if (Math.abs(Math.floor(b.x / TERRITORY_UNIT) - col) <= reach && Math.abs(Math.floor(b.y / TERRITORY_UNIT) - row) <= reach)
          return t("Le territoire d'une forteresse ne peut pas chevaucher celui d'une autre forteresse.");
      }
    }
    if (this.forbidden.circleHits(candidate.x, candidate.y, radius)) return t("Le bâtiment chevauche une zone interdite.");
    if (this.resourceRadius > 0 && this.resourceGrid.anyWithin(candidate.x, candidate.y, radius + this.resourceRadius))
      return t("Le bâtiment chevauche un point de ressource.");
    if (mapStructureCollision(candidate, this.structures)) return t("Le bâtiment chevauche une structure de la carte.");
    const { ownership } = this.state(plan.buildings);
    if (!isConnectedToAlliance(candidate, ownership))
      return t("Reliez les drapeaux au territoire de cette alliance. Commencez par une forteresse.");
    // Une forteresse peut recouvrir des territoires de drapeaux ; seul le chevauchement de forteresses est interdit (règle plus haut).
    if (!isFortress(candidate.kind) && !hasRequiredTerritoryAvailability(candidate, ownership))
      return t("Une trop grande part de cette emprise appartient à une autre alliance.");
    return null;
  }

  /** Case de chaque ressource (dédoublonnée par id), calculée une fois. */
  private resourceKeys: { kind: ResourcePoint["kind"]; key: string }[] | null = null;

  private covered(ownership: TerritoryState["ownership"], allianceId: string) {
    const keys = (this.resourceKeys ??= (() => {
      const seen = new Set<number>();
      const out: { kind: ResourcePoint["kind"]; key: string }[] = [];
      for (const r of this.data.resources) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ kind: r.kind, key: cellKey(Math.floor(r.x / TERRITORY_UNIT), Math.floor(r.y / TERRITORY_UNIT)) });
      }
      return out;
    })());
    const counts = emptyCounts();
    for (const r of keys) if (ownership.get(r.key)?.allianceId === allianceId) counts[r.kind] += 1;
    return counts;
  }

  summary(plan: Plan, allianceId: string) {
    const state = this.state(plan.buildings);
    const covered = this.covered(state.ownership, allianceId);
    const rates = this.catalog.resourceProductionPerHour;
    const production = {
      food: covered.food * (rates.food ?? 0),
      wood: covered.wood * (rates.wood ?? 0),
      stone: covered.stone * (rates.stone ?? 0),
      coin: covered.coin * (rates.gold ?? 0),
      crystal: covered.crystal * (rates.crystal ?? 0),
    };
    const entries = buildingCostBreakdown(plan.buildings, this.catalog.costs, allianceId);
    return { ownership: state.ownership, covered, production, entries, costs: calculateCostTotals(entries) };
  }
}
