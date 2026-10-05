/** Classeur Excel des sanctuaires (chargé à la demande : fflate n'est pas dans le paquet principal). */
import { toGame, toReal } from "./coords";
import { t } from "./i18n";
import type { TerritoryOwnership } from "./geometry";
import { BONUSES, bonusByKey, bonusKeyFromName, formatPercents, sanctuaryGroups, type SanctuaryGroup } from "./sanctuary";
import type { Plan, Sanctuary } from "./types";
import { readXlsx, type Sheet, writeXlsx } from "./xlsx";

export function sanctuariesToWorkbook(list: readonly Sanctuary[], plan?: Plan, ownership?: TerritoryOwnership): Uint8Array {
  const head = [t("nom du bonus"), t("valeur du bonus"), t("position x"), t("position Y")].map((v) => ({ v, bold: true }));
  const rows: Sheet["rows"] = [head];
  for (const s of list) rows.push([bonusByKey(s.bonus)?.label ?? s.bonus, s.value, toGame(s.x), toGame(s.y)]);
  const sheets: Sheet[] = [{ name: t("Feuil1"), rows, widths: [30, 16, 12, 12] }];

  const head2 = [t("Bonus"), t("Nombre"), t("Total"), t("Total 2")].map((v) => ({ v, bold: true }));
  const totalRows: Sheet["rows"] = [head2];
  const addGroups = (groups: SanctuaryGroup[]) =>
    groups.forEach((g) => totalRows.push([g.def.label, g.count, g.totals[0], g.totals[1] ?? null]));
  addGroups(sanctuaryGroups(list));
  if (plan && ownership) {
    for (const alliance of plan.alliances) {
      const mine = sanctuaryGroups(list, { ownership, allianceId: alliance.id });
      if (!mine.length) continue;
      totalRows.push([null, null, null, null], [{ v: t("Dans le territoire de {name}", { name: alliance.name }), bold: true }, null, null, null]);
      addGroups(mine);
    }
  }
  sheets.push({ name: t("Totaux"), rows: totalRows, widths: [62, 10, 10, 10] });
  return writeXlsx(sheets);
}

export type SanctuaryImport = { sanctuaries: { bonus: string; value: number; x: number; y: number }[]; skipped: string[] };

/** Lit le premier onglet : colonnes nom du bonus, valeur, x, y (en-tête facultatif ; 5 ou 0,05 acceptés pour 5 %). */
export function parseSanctuaryWorkbook(bytes: Uint8Array): SanctuaryImport {
  const rows = readXlsx(bytes);
  const out: SanctuaryImport = { sanctuaries: [], skipped: [] };
  rows.forEach((row, i) => {
    const [name, rawValue, rawX, rawY] = row;
    if (!name && !rawX) return;
    const toNum = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === "" ? NaN : Number(v.replace(",", ".")));
    const x = toNum(rawX);
    const y = toNum(rawY);
    if (i === 0 && !Number.isFinite(x)) return; // en-tête
    const key = bonusKeyFromName(name ?? "");
    if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return void out.skipped.push(t("ligne {n}", { n: i + 1 }));
    if (bonusByKey(key)!.parts.length > 1) return void out.sanctuaries.push({ bonus: key, value: bonusByKey(key)!.value, x: toReal(Math.round(x)), y: toReal(Math.round(y)) });
    let value = Number(String(rawValue ?? "").replace("%", "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) value = bonusByKey(key)!.value;
    else if (value >= 1) value /= 100;
    out.sanctuaries.push({ bonus: key, value: Math.round(value * 1e6) / 1e6, x: toReal(Math.round(x)), y: toReal(Math.round(y)) });
  });
  return out;
}

