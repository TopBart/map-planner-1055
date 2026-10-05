import { describe, expect, it } from "vitest";
import { parseWorkbook, planToWorkbook } from "../src/core/excelPlan";
import { readXlsx, writeXlsx } from "../src/core/xlsx";
import type { Plan } from "../src/core/types";

describe("xlsx", () => {
  it("relit ce qu'il écrit (accents, & et chiffres)", () => {
    const bytes = writeXlsx([{ name: "A", rows: [[{ v: "Équipe & Cie", bold: true }, null, 12], [null, "x<y"]] }]);
    const grid = readXlsx(bytes);
    expect(grid[0][0]).toBe("Équipe & Cie");
    expect(grid[0][2]).toBe("12");
    expect(grid[1][1]).toBe("x<y");
  });

  it("aller-retour d'un plan au format du site (coordonnées de jeu ×6)", () => {
    const plan: Plan = {
      version: 2, map: "m", mode: "territory", annotations: [], routes: [],
      alliances: [{ id: "a", name: "ROKB", color: "#00DEFF" }, { id: "b", name: "FR01", color: "#FF8A00" }],
      buildings: [
        { id: "1", kind: "fortress", allianceId: "a", x: 600, y: 1200 },
        { id: "2", kind: "flag", allianceId: "a", x: 654, y: 1200 },
        { id: "3", kind: "center-fortress", allianceId: "b", x: 300, y: 300 },
        { id: "4", kind: "horse", allianceId: "b", x: 360, y: 300 },
      ],
    };
    const parsed = parseWorkbook(planToWorkbook(plan));
    expect(parsed.map((a) => a.name)).toEqual(["ROKB", "FR01"]);
    expect(parsed[0].buildings).toEqual([
      { kind: "fortress", x: 600, y: 1200 },
      { kind: "flag", x: 654, y: 1200 },
    ]);
    expect(parsed[1].buildings.map((b) => b.kind)).toEqual(["center-fortress", "horse"]);
  });

  it("refuse un fichier qui n'est pas un classeur", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/xlsx/);
  });
});
