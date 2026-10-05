import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { encodeJson } from "../src/core/container";
import type { Catalog, MapData, Plan } from "../src/core/types";
import { newPlan } from "../src/core/types";

export const SLUG = "Demo_Map_v1";

export function makeCatalog(): Catalog {
  return {
    schemaVersion: 2,
    map: SLUG,
    name: "Carte de démonstration",
    season: "preparation",
    order: 1,
    categories: ["structures", "forbidden", "rss", "province"],
    bounds: [-60, -60, 660, 660],
    pixelSize: [1440, 1440],
    assets: {},
    structureIcons: { "1": "struct.png" },
    structureRules: {
      "1": {
        collision: { shape: "territory-square", radiusInCells: 1 },
        territoryRadiusInCells: 2,
        teleportRadiusInCells: 4,
        claimable: true,
      },
    },
    buildingIcons: { flag: "flag.png", fortress: "fort.png", "center-fortress": "fort.png", horse: "horse.png" },
    siteIcons: { food: "food.png", wood: "wood.png", stone: "stone.png", coin: "coin.png", crystal: "crystal.png" },
    buildings: { fortress: { limit: 2 }, flag: { limit: 50 } },
    costs: {
      fortress: [
        { from: 1, to: 1, cost: { credits: 100, wood: 10 } },
        { from: 2, to: 2, cost: { credits: 200, wood: 20 } },
      ],
      flag: [{ from: 1, to: 50, cost: { credits: 5, food: 1 } }],
    },
    resourceProductionPerHour: { food: 10, wood: 20, stone: 30, gold: 40, crystal: 50 },
    ruleset: "lost-land",
    nativeMapSize: 600,
  };
}

export function makeData(): MapData {
  const cells = new Uint8Array(10 * 10).fill(1);
  cells[0] = 2; // province 2 en bas à gauche : bloque les drapeaux
  return {
    sites: [{ id: "structures:1", kind: "pass", x: 300, y: 300, strongholdType: 1, label: "Passe" }],
    landmarks: [],
    resources: [
      { id: 1, kind: "food", x: 100, y: 100 },
      { id: 2, kind: "wood", x: 110, y: 100 },
      { id: 3, kind: "coin", x: 500, y: 500 },
    ],
    definitions: [{ id: 7, vertices: [[0, 0], [60, 0], [0, 60]], indices: [0, 1, 2] }],
    instances: [{ mesh: 7, affine: [1, 0, 0, 1, 200, 50] }],
    province: { cellSize: 60, width: 10, height: 10, cells, flagBlocked: new Set([2]), fortressBlocked: new Set() },
  };
}

export function plan(): Plan {
  return newPlan(SLUG);
}

/** Écrit un dossier de données complet (format du script de téléchargement) pour tester le chargeur. */
export function writeDataDir(root: string): void {
  const catalog = makeCatalog();
  const data = makeData();
  const dir = join(root, "maps", SLUG);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, unknown> = {
    structures: { gameMap: SLUG, category: "structures", points: data.sites.map((s) => ({ ...s, id: 1 })) },
    forbidden: { gameMap: SLUG, category: "forbidden", definitions: data.definitions, instances: data.instances },
    rss: { gameMap: SLUG, category: "rss", points: data.resources },
    province: {
      gameMap: SLUG,
      category: "province",
      cellSize: 60,
      width: 10,
      height: 10,
      cells: Array.from(data.province!.cells),
      flagBlocked: [2],
      fortressBlocked: [],
    },
  };
  for (const [category, value] of Object.entries(files)) {
    const bytes = encodeJson(value, 99);
    writeFileSync(join(dir, `${category}.bin`), bytes);
    catalog.assets[`${category}.bin`] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    };
  }
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
  writeFileSync(
    join(root, "maps.json"),
    JSON.stringify({ maps: [{ map: SLUG, name: catalog.name, season: "preparation", order: 1, categories: catalog.categories }] })
  );
}
