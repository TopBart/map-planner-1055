import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toGame } from "../src/core/coords";
import { parseSanctuaryWorkbook, sanctuariesToWorkbook } from "../src/core/sanctuaryExcel";
import { cellKey } from "../src/core/geometry";
import { bonusKeyFromName, sanctuaryGroups, mergeSanctuaries, sanctuaryTotals } from "../src/core/sanctuary";

const file = new Uint8Array(readFileSync(new URL("./data/position_sanctuaire.xlsx", import.meta.url)));

describe("sanctuaires", () => {
  it("lit le fichier de l'utilisateur (25 lignes, tous les bonus reconnus)", () => {
    const r = parseSanctuaryWorkbook(file);
    expect(r.sanctuaries).toHaveLength(24); // la ligne 26 n'a pas de position Y
    expect(r.skipped).toHaveLength(1);
    expect(r.sanctuaries[0]).toMatchObject({ bonus: "harvest", value: 0.05 });
    expect(toGame(r.sanctuaries[0].x)).toBe(47);
    expect(toGame(r.sanctuaries[0].y)).toBe(1124);
  });
  it("reconnaît les variantes de libellé", () => {
    expect(bonusKeyFromName("Vitesse de recolte")).toBe("harvest");
    expect(bonusKeyFromName("gain d'exp de commandant ")).toBe("exp");
    expect(bonusKeyFromName("santé de troupes")).toBe("health");
    expect(bonusKeyFromName("vitesse d'entrainement")).toBe("training");
    expect(bonusKeyFromName("n'importe quoi")).toBeNull();
  });
  it("gère les 4 doubles bonus (libellés, totaux par statistique)", () => {
    expect(bonusKeyFromName("Défense de troupes 3% avec Santé de troupes 3%")).toBe("def-health");
    expect(bonusKeyFromName("Attaque de troupes en rassemblement 5% avec Vitesse de récolte 5%")).toBe("rally-harvest");
    expect(bonusKeyFromName("Attaque de troupes 3% avec Vitesse d'entrainement 10%")).toBe("attack-training");
    expect(bonusKeyFromName("Restauration de point d'action 20% avec Vitesse de soin 20%")).toBe("ap-heal");
    expect(bonusKeyFromName("Attaque de troupes")).toBe("attack");
    const list = [
      { id: "1", bonus: "attack-training", value: 0.03, x: 6, y: 6 },
      { id: "2", bonus: "attack", value: 0.03, x: 12, y: 6 },
      { id: "3", bonus: "ap-heal", value: 0.2, x: 18, y: 6 },
    ];
    const t = sanctuaryTotals(list);
    expect(t.totals.get("attack")).toBeCloseTo(0.06, 6);
    expect(t.totals.get("training")).toBeCloseTo(0.1, 6);
    expect(t.totals.get("heal")).toBeCloseTo(0.2, 6);
    const again = parseSanctuaryWorkbook(sanctuariesToWorkbook(list));
    expect(again.sanctuaries.map((q) => q.bonus)).toEqual(["attack-training", "attack", "ap-heal"]);
  });
  it("regroupe par type : un double bonus reste sur une ligne, et filtre par territoire", () => {
    const list = [
      { id: "1", bonus: "attack-training", value: 0.03, x: 9, y: 9 },
      { id: "2", bonus: "attack-training", value: 0.03, x: 27, y: 9 },
      { id: "3", bonus: "attack", value: 0.03, x: 9, y: 27 },
      { id: "4", bonus: "harvest", value: 0.05, x: 500, y: 500 },
    ];
    const ownership = new Map([[cellKey(0, 0), { column: 0, row: 0, allianceId: "a" }], [cellKey(1, 0), { column: 1, row: 0, allianceId: "a" }], [cellKey(0, 1), { column: 0, row: 1, allianceId: "a" }]]);
    const mine = sanctuaryGroups(list, { ownership, allianceId: "a" });
    expect(mine.map((g) => [g.def.key, g.count])).toEqual([["attack", 1], ["attack-training", 2]]);
    expect(mine[1].totals[0]).toBeCloseTo(0.06, 6);
    expect(mine[1].totals[1]).toBeCloseTo(0.2, 6);
    expect(sanctuaryGroups(list)).toHaveLength(3);
  });
  it("exporte puis relit à l'identique, et totalise", () => {
    const list = mergeSanctuaries([], parseSanctuaryWorkbook(file).sanctuaries, () => Math.random().toString(36).slice(2)).list;
    const again = parseSanctuaryWorkbook(sanctuariesToWorkbook(list));
    expect(again.sanctuaries.map((s) => [s.bonus, s.value, s.x, s.y])).toEqual(list.map((s) => [s.bonus, s.value, s.x, s.y]));
    const t = sanctuaryTotals(list);
    expect(t.counts.get("harvest")).toBe(5);
    expect(t.totals.get("harvest")).toBeCloseTo(0.25, 6);
    const merged = mergeSanctuaries(list, [{ bonus: "exp", value: 0.1, x: list[0].x, y: list[0].y }], () => "n");
    expect(merged.updated).toBe(1);
    expect(merged.list).toHaveLength(list.length);
  });
});

describe("langue et alias", () => {
  it("un export en anglais se relit et « rally » seul n'est pas pris pour un double bonus", async () => {
    const { setLang } = await import("../src/core/i18n");
    const { bonusKeyFromName, BONUSES } = await import("../src/core/sanctuary");
    const { parseSanctuaryWorkbook, sanctuariesToWorkbook } = await import("../src/core/sanctuaryExcel");
    setLang("en");
    try {
      const list = BONUSES.map((b, i) => ({ id: String(i), bonus: b.key, value: b.value, x: 60 + i * 12, y: 120 }));
      const back = parseSanctuaryWorkbook(sanctuariesToWorkbook(list));
      expect(back.skipped).toEqual([]);
      expect(back.sanctuaries.map((s) => s.bonus)).toEqual(BONUSES.map((b) => b.key));
    } finally {
      setLang("fr");
    }
    expect(bonusKeyFromName("Rally troop attack")).toBeNull();
    expect(bonusKeyFromName("Attaque en rassemblement + Vitesse de récolte")).toBe("rally-harvest");
  });
});
