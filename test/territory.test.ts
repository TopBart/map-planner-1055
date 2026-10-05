import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadMapData, loadMapList } from "../src/core/dataset";
import { circleIntersectsTriangle } from "../src/core/geometry";
import { History, LIMITS, parsePlan, updateSelection } from "../src/core/plan";
import { TriangleIndex } from "../src/core/spatial";
import { TerritoryEngine } from "../src/core/territory";
import type { Building, Plan } from "../src/core/types";
import { makeCatalog, makeData, plan as makePlan, SLUG, writeDataDir } from "./fixture";

const engine = () => new TerritoryEngine(makeCatalog(), makeData());
const building = (kind: Building["kind"], x: number, y: number, id = `${kind}-${x}-${y}`): Building => ({
  id,
  kind,
  allianceId: "alliance-1",
  x,
  y,
});
const withBuildings = (...buildings: Building[]): Plan => ({ ...makePlan(), buildings });

describe("index spatial des zones interdites", () => {
  it("donne les mêmes résultats qu'un parcours exhaustif", () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const vertices: [number, number][] = [];
    const indices: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = random() * 900;
      const y = random() * 900;
      const base = vertices.length;
      vertices.push([x, y], [x + random() * 70 + 5, y + random() * 20], [x + random() * 20, y + random() * 70 + 5]);
      indices.push(base, base + 1, base + 2);
    }
    const index = new TriangleIndex(
      [{ id: 3, vertices, indices }],
      [{ mesh: 3, affine: [1, 0, 0, 1, 0, 0] }]
    );
    const t = index.triangles;
    let hits = 0;
    for (let n = 0; n < 4000; n++) {
      const x = random() * 1000 - 50;
      const y = random() * 1000 - 50;
      const radius = 1 + random() * 8;
      let expected = false;
      for (let o = 0; o < t.length && !expected; o += 6)
        expected = circleIntersectsTriangle(x, y, radius, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]);
      expect(index.circleHits(x, y, radius)).toBe(expected);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(100);
    expect(hits).toBeLessThan(3900);
  });

  it("résout les instances par identifiant de définition, pas par position", () => {
    const index = new TriangleIndex(
      [
        { id: 40, vertices: [[0, 0], [10, 0], [0, 10]], indices: [0, 1, 2] },
        { id: 5, vertices: [[0, 0], [10, 0], [0, 10]], indices: [0, 1, 2] },
      ],
      [{ mesh: 5, affine: [1, 0, 0, 1, 100, 100] }]
    );
    expect(index.count).toBe(1);
    expect(index.circleHits(103, 103, 1)).toBe(true);
    expect(index.circleHits(3, 3, 1)).toBe(false);
  });
});

describe("règles de placement", () => {
  it("autorise une forteresse sur un terrain libre", () => {
    const e = engine();
    expect(e.placementError(building("fortress", 100, 400), makePlan())).toBeNull();
  });

  it("refuse un bâtiment qui chevauche un point de ressource (hit box réglable)", () => {
    const e = engine();
    const plan = withBuildings(building("fortress", 100, 140));
    // ressource en (100,100), hit box 2,04 : un drapeau à 2 unités chevauche (2,04 + 1,4)
    expect(e.placementError(building("flag", 100, 102), plan)).toMatch(/point de ressource/);
    expect(e.placementError(building("flag", 100, 106), plan)).toBeNull(); // à 6 unités : hors de la hit box
    e.resourceRadius = 0;
    expect(e.placementError(building("flag", 100, 102), plan)).toBeNull();
  });

  it("refuse un drapeau sans territoire, puis l'accepte à côté d'une forteresse", () => {
    const e = engine();
    const fortress = building("fortress", 100, 400);
    expect(e.placementError(building("flag", 100, 400), makePlan())).toMatch(/Reliez les drapeaux/);
    const plan = withBuildings(fortress);
    expect(e.placementError(building("flag", 100, 470), plan)).toBeNull();
    expect(e.placementError(building("flag", 100, 560), plan)).toMatch(/Reliez les drapeaux/);
  });

  it("refuse deux forteresses dont les territoires se chevauchent (les drapeaux ne comptent pas)", () => {
    const e = engine();
    const plan = withBuildings(building("fortress", 100, 400));
    expect(e.placementError(building("fortress", 172, 400), plan)).toMatch(/chevaucher celui d'une autre forteresse/);
    expect(e.placementError(building("fortress", 190, 400), plan)).toBeNull();
    // un drapeau peut empiéter sur le territoire d'une forteresse
    expect(e.placementError(building("flag", 160, 400), plan)).toBeNull();
  });

  it("autorise une forteresse sur un territoire formé uniquement de drapeaux d'une autre alliance", () => {
    const e = engine();
    const base: Plan = {
      ...makePlan(),
      alliances: [...makePlan().alliances, { id: "alliance-2", name: "ABCD", color: "#FF0000" }],
      buildings: [
        { ...building("fortress", 100, 400), allianceId: "alliance-2" },
        { ...building("flag", 100, 470), allianceId: "alliance-2" },
      ],
    };
    // forteresse d'alliance-1 dont le territoire (5×5) recouvre entièrement celui du drapeau, sans toucher la forteresse
    expect(e.placementError(building("flag", 100, 470), makePlan())).toMatch(/Reliez/);
    expect(e.placementError(building("fortress", 100, 520), base)).toBeNull();
  });

  it("refuse les zones interdites, les structures et l'extérieur de la carte", () => {
    const e = engine();
    expect(e.placementError(building("fortress", 210, 60), makePlan())).toMatch(/zone interdite/);
    expect(e.placementError(building("fortress", 300, 300), makePlan())).toMatch(/structure/);
    expect(e.placementError(building("fortress", 2, 300), makePlan())).toMatch(/zone jouable/);
    expect(e.placementError(building("fortress", 300, 599), makePlan())).toMatch(/zone jouable/);
  });

  it("applique la limite de bâtiments et les provinces restreintes", () => {
    const e = engine();
    const plan = withBuildings(building("fortress", 100, 400), building("fortress", 100, 500));
    expect(e.placementError(building("fortress", 400, 400), plan)).toMatch(/limite/);
    // province 2 = cellule (0,0) : bloque les drapeaux uniquement
    const near = withBuildings(building("fortress", 100, 100));
    expect(e.placementError(building("flag", 30, 30), near)).toMatch(/province/);
    expect(e.placementError(building("fortress", 30, 30), makePlan())).toBeNull();
  });

  it("refuse deux bâtiments qui se chevauchent", () => {
    const e = engine();
    expect(e.placementError(building("fortress", 101, 401), withBuildings(building("fortress", 100, 400)))).toMatch(
      /occupe/
    );
  });
  it("refuse une forteresse dont l'emprise chevauche celle d'une autre alliance", () => {
    const e = engine();
    const other: Plan = {
      ...makePlan(),
      alliances: [...makePlan().alliances, { id: "alliance-2", name: "ABCD", color: "#FF0000" }],
      buildings: [{ ...building("fortress", 100, 400), allianceId: "alliance-2" }],
    };
    expect(e.placementError(building("fortress", 118, 400), other)).toMatch(/chevaucher celui d.une autre forteresse/);
  });
});

describe("territoire, ressources et coûts", () => {
  it("compte les ressources couvertes et calcule la production", () => {
    const e = engine();
    const plan = withBuildings(building("fortress", 100, 100));
    const summary = e.summary(plan, "alliance-1");
    expect(summary.covered).toMatchObject({ food: 1, wood: 1, coin: 0 });
    expect(summary.production).toMatchObject({ food: 10, wood: 20, coin: 0 });
  });

  it("applique les paliers de coût dans l'ordre de pose", () => {
    const e = engine();
    const plan = withBuildings(building("fortress", 100, 400), building("fortress", 100, 500), building("flag", 100, 450));
    const { costs, entries } = e.summary(plan, "alliance-1");
    expect(entries.map((x) => [x.building.kind, x.number])).toEqual([
      ["fortress", 1],
      ["fortress", 2],
      ["flag", 1],
    ]);
    expect(costs).toMatchObject({ credits: 305, wood: 30, food: 1, unknown: 0 });
  });

  it("annexe une structure revendicable touchée par le territoire", () => {
    const e = engine();
    const state = e.state([building("fortress", 300, 380)].map((b) => b));
    expect([...state.structureOwners.values()]).toEqual(["alliance-1"]);
  });

  it("mémorise la propriété tant que le tableau de bâtiments ne change pas", () => {
    const e = engine();
    const buildings = [building("fortress", 100, 400)];
    expect(e.state(buildings)).toBe(e.state(buildings));
    expect(e.state([...buildings])).not.toBe(e.state(buildings));
  });
});

describe("chargement des données et plans", () => {
  it("charge un dossier de données au format du script de téléchargement", async () => {
    const root = mkdtempSync(join(tmpdir(), "rok-"));
    writeDataDir(root);
    const read = async (path: string) => new Uint8Array(readFileSync(join(root, path)));
    const list = await loadMapList(read);
    expect(list.map((m) => m.map)).toEqual([SLUG]);
    const catalog = await loadCatalog(read, SLUG);
    const data = await loadMapData(read, catalog);
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0].id).toBe("structures:1");
    expect(data.resources).toHaveLength(3);
    expect(data.definitions[0].id).toBe(7);
    expect(data.province?.cells).toHaveLength(100);
    expect(data.province?.flagBlocked.has(2)).toBe(true);
  });

  it("détecte un fichier modifié (empreinte SHA-256)", async () => {
    const root = mkdtempSync(join(tmpdir(), "rok-"));
    writeDataDir(root);
    const read = async (path: string) => {
      const bytes = new Uint8Array(readFileSync(join(root, path)));
      if (path.endsWith("rss.bin")) bytes[bytes.length - 1] ^= 1;
      return bytes;
    };
    const catalog = await loadCatalog(read, SLUG);
    await expect(loadMapData(read, catalog)).rejects.toThrow();
  });

  it("valide les plans importés", () => {
    const original = withBuildings(building("fortress", 100, 400));
    expect(parsePlan(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(() => parsePlan({ ...original, version: 1 })).toThrow(/version/);
    expect(() => parsePlan({ ...original, buildings: [{ ...original.buildings[0], allianceId: "nope" }] })).toThrow(
      /alliance/
    );
    expect(() => parsePlan({ ...original, buildings: [{ ...original.buildings[0], x: Number.NaN }] })).toThrow();
    expect(() =>
      parsePlan({ ...original, annotations: Array.from({ length: LIMITS.annotations + 1 }, () => ({})) })
    ).toThrow(/annotations/);
  });

  it("gère l'historique et la sélection", () => {
    const history = new History(1);
    history.push(2);
    history.push(3);
    expect(history.undo()).toBe(2);
    expect(history.redo()).toBe(3);
    history.undo();
    history.push(9);
    expect(history.canRedo).toBe(false);
    expect([...updateSelection(new Set(["a"]), "b", false)]).toEqual(["b"]);
    expect([...updateSelection(new Set(["a"]), "b", true)]).toEqual(["a", "b"]);
    expect([...updateSelection(new Set(["a", "b"]), "b", true)]).toEqual(["a"]);
  });
});

describe("état de territoire incrémental", () => {
  it("donne le même résultat qu'un calcul complet", async () => {
    const { buildTerritoryState } = await import("../src/core/geometry");
    const bs = Array.from({ length: 60 }, (_, i) => ({ id: String(i), kind: "flag" as const, allianceId: i % 2 ? "a" : "b", x: 40 + (i % 10) * 25, y: 40 + Math.floor(i / 10) * 25 }));
    const sig = (s: ReturnType<typeof buildTerritoryState>) => [...s.ownership].map(([k, v]) => k + v.allianceId).sort().join();
    const part = buildTerritoryState(bs.slice(0, 59));
    expect(sig(buildTerritoryState(bs, [], { state: part, from: 59 }))).toBe(sig(buildTerritoryState(bs)));
    expect(part.ownership.size).toBe(buildTerritoryState(bs.slice(0, 59)).ownership.size); // base non modifiée
  });
});
