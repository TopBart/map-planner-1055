import { describe, expect, it } from "vitest";
import { parseWorkbook, planToWorkbook } from "../src/core/excelPlan";
import { mergeImported } from "../src/core/importPlan";
import { TerritoryEngine } from "../src/core/territory";
import { newPlan } from "../src/core/types";
import { makeCatalog, makeData } from "./fixture";

let n = 0;
const id = () => `i${++n}`;

describe("import Excel dans un plan", () => {
  const engine = new TerritoryEngine(makeCatalog(), makeData());

  it("pose fortresse puis drapeaux reliés, refuse un drapeau isolé", () => {
    const plan = newPlan("Demo_Map_v1");
    const source = newPlan("Demo_Map_v1");
    source.buildings = [
      { id: "f", kind: "fortress", allianceId: "alliance-1", x: 108, y: 450 },
      { id: "g", kind: "flag", allianceId: "alliance-1", x: 162, y: 450 },
      { id: "z", kind: "flag", allianceId: "alliance-1", x: 504, y: 108 },
    ];
    const parsed = parseWorkbook(planToWorkbook(source));
    const r = mergeImported(plan, parsed, engine, false, id);
    expect(r.placed).toBe(2);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].kind).toBe("flag");
    expect(r.plan.alliances).toHaveLength(1); // même nom : complète « ROKB »
    expect(r.plan.buildings).toHaveLength(2);
    // le drapeau isolé est conservé si on force
    expect(mergeImported(plan, parsed, engine, true, id).plan.buildings).toHaveLength(3);
  });

  it("accepte un drapeau listé avant sa forteresse (plusieurs passes) et crée une nouvelle alliance", () => {
    const plan = newPlan("Demo_Map_v1");
    const r = mergeImported(plan, [{ name: "Autres", buildings: [{ kind: "flag", x: 162, y: 450 }, { kind: "fortress", x: 108, y: 450 }] }], engine, false, id);
    expect(r.placed).toBe(2);
    expect(r.plan.alliances.map((a) => a.name)).toEqual(["ROKB", "Autres"]);
  });
});
