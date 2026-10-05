import { t } from "./i18n";
import { countResourcesCoveredByBuilding } from "./geometry";
import { toGame, toReal } from "./coords";
import type { TerritoryEngine } from "./territory";
import type { BuildingKind, Plan } from "./types";
import { type Cell, readXlsx, type Sheet, writeXlsx } from "./xlsx";

/** Libellés du fichier Excel du site (anglais) : un classeur exporté ici s'importe sur le site et inversement. */
const LABELS: Record<BuildingKind, string> = {
  "center-fortress": "Center fortress",
  fortress: "Alliance fortress",
  horse: "Alliance horse",
  flag: "Flag",
};
const ORDER: BuildingKind[] = ["center-fortress", "fortress", "horse", "flag"];

import { KIND_FR } from "./labels";
export { KIND_FR };

/** Feuille « Plan » au format du site (une colonne par alliance, coordonnées de jeu) + feuille « Détail ». */
export function planToWorkbook(plan: Plan, engine?: TerritoryEngine): Uint8Array {
  const columns: Cell[][] = plan.alliances.map((alliance) => {
    const mine = plan.buildings.filter((b) => b.allianceId === alliance.id);
    const column: Cell[] = [{ v: alliance.name, bold: true }, null];
    for (const kind of ORDER) {
      const placed = mine.filter((b) => b.kind === kind);
      if (kind === "flag" && placed.length > 0 && column.length > 2) column.push(null);
      placed.forEach((b, i) => {
        const label = kind === "flag" || kind === "fortress" ? `${LABELS[kind]} ${i + 1}` : LABELS[kind];
        column.push(`${label}: (${toGame(b.x)}, ${toGame(b.y)})`);
      });
    }
    return column;
  });
  const rows: Cell[][] = Array.from({ length: Math.max(0, ...columns.map((c) => c.length)) }, (_, r) =>
    columns.flatMap((column, i) => (i === 0 ? [column[r] ?? null] : [null, column[r] ?? null]))
  );
  const widths = columns.flatMap((_, i) => (i === 0 ? [40] : [4, 40]));
  const sheets: Sheet[] = [{ name: "Plan", rows, widths }];

  const detail: Cell[][] = [[...t("Alliance,Type,N°,X,Y,Nourriture,Bois,Pierre,Or,Cristal").split(",")].map((v) => ({ v, bold: true }))];
  const counts = new Map<string, number>();
  const ownership = engine?.state(plan.buildings).ownership;
  for (const b of plan.buildings) {
    const n = (counts.get(`${b.allianceId}:${b.kind}`) ?? 0) + 1;
    counts.set(`${b.allianceId}:${b.kind}`, n);
    const rss = engine && ownership ? countResourcesCoveredByBuilding(ownership, b, engine.data.resources) : null;
    detail.push([
      plan.alliances.find((a) => a.id === b.allianceId)?.name ?? "?",
      KIND_FR[b.kind],
      n,
      toGame(b.x),
      toGame(b.y),
      ...(rss ? [rss.food, rss.wood, rss.stone, rss.coin, rss.crystal] : []),
    ]);
  }
  sheets.push({ name: t("Détail"), rows: detail, widths: [20, 22, 6, 8, 8, 12, 10, 10, 10, 10] });
  return writeXlsx(sheets);
}

export type ImportedAlliance = { name: string; buildings: { kind: BuildingKind; x: number; y: number }[] };

const LINE = /^(.+?)\s*:\s*\(\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*\)\s*$/;

function kindOf(label: string): BuildingKind | null {
  const l = label.toLowerCase();
  if (/(center|centre|centr)/.test(l) && /(fortress|forteresse)/.test(l)) return "center-fortress";
  if (/(fortress|forteresse)/.test(l)) return "fortress";
  if (/(horse|cheval)/.test(l)) return "horse";
  if (/(flag|drapeau)/.test(l)) return "flag";
  return null;
}

/** Lit un classeur du site (ou de cette appli) : alliances en colonnes, lignes « Flag 3: (x, y) » en coordonnées de jeu. */
export function parseWorkbook(bytes: Uint8Array): ImportedAlliance[] {
  const grid = readXlsx(bytes);
  const width = Math.max(0, ...grid.map((r) => r.length));
  const result: ImportedAlliance[] = [];
  for (let c = 0; c < width; c++) {
    let header: string | null = null;
    const buildings: ImportedAlliance["buildings"] = [];
    for (const row of grid) {
      const text = row[c]?.trim();
      if (!text) continue;
      const m = LINE.exec(text);
      const kind = m ? kindOf(m[1]) : null;
      if (m && kind) buildings.push({ kind, x: toReal(Math.round(Number(m[2].replace(",", ".")))), y: toReal(Math.round(Number(m[3].replace(",", ".")))) });
      else if (header === null && !buildings.length) header = text.slice(0, 80);
    }
    if (buildings.length) result.push({ name: header ?? `Alliance ${result.length + 1}`, buildings });
  }
  if (!result.length) throw new Error(t("Aucun bâtiment reconnu (attendu : « Flag 1: (x, y) » sous le nom de chaque alliance)."));
  return result;
}
