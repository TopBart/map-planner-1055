import { t } from "./i18n";
import { LIMITS, nextAllianceColor } from "./plan";
import type { ImportedAlliance } from "./excelPlan";
import type { TerritoryEngine } from "./territory";
import type { Alliance, Building, BuildingKind, Plan } from "./types";

export type Refused = { alliance: string; kind: BuildingKind; x: number; y: number; reason: string };
export type ImportReport = { plan: Plan; placed: number; forced: number; refused: Refused[] };

/**
 * Intègre des alliances importées dans un plan. Chaque bâtiment est validé avec les règles de la carte,
 * en plusieurs passes : les drapeaux ne sont acceptés qu'une fois la forteresse qui les relie posée.
 * Une alliance de même nom (insensible à la casse) est complétée au lieu d'être dupliquée.
 */
export function mergeImported(plan: Plan, imported: ImportedAlliance[], engine: TerritoryEngine, force: boolean, newId: () => string): ImportReport {
  let current: Plan = plan;
  const alliances: Alliance[] = [...plan.alliances];
  type Pending = { building: Building; name: string; reason: string };
  const pending: Pending[] = [];
  const refused: Refused[] = [];

  for (const source of imported) {
    let alliance = alliances.find((a) => a.name.trim().toLowerCase() === source.name.trim().toLowerCase());
    if (!alliance) {
      if (alliances.length >= LIMITS.alliances) {
        for (const b of source.buildings) refused.push({ alliance: source.name, kind: b.kind, x: b.x, y: b.y, reason: t("Limite d'alliances atteinte.") });
        continue;
      }
      alliance = { id: `alliance-${newId()}`, name: source.name, color: nextAllianceColor(alliances) };
      alliances.push(alliance);
    }
    for (const b of source.buildings) pending.push({ building: { id: newId(), kind: b.kind, allianceId: alliance.id, x: b.x, y: b.y }, name: source.name, reason: "" });
  }
  current = { ...current, alliances };

  // Les bâtiments racines (forteresses, cheval) d'abord, puis les drapeaux ; l'ordre du fichier est conservé.
  let queue = [...pending.filter((p) => p.building.kind !== "flag"), ...pending.filter((p) => p.building.kind === "flag")];
  let placed = 0;
  for (let pass = 0; pass < 8 && queue.length; pass++) {
    const next: Pending[] = [];
    let progress = false;
    for (const item of queue) {
      if (current.buildings.length >= LIMITS.buildings) {
        item.reason = t("Limite de bâtiments atteinte.");
        next.push(item);
        continue;
      }
      const error = engine.placementError(item.building, current);
      if (error) {
        item.reason = error;
        next.push(item);
      } else {
        current = { ...current, buildings: [...current.buildings, item.building] };
        placed++;
        progress = true;
      }
    }
    queue = next;
    if (!progress) break;
  }

  let forced = 0;
  for (const item of queue) {
    if (force && current.buildings.length < LIMITS.buildings) {
      current = { ...current, buildings: [...current.buildings, item.building] };
      forced++;
    } else refused.push({ alliance: item.name, kind: item.building.kind, x: item.building.x, y: item.building.y, reason: item.reason });
  }
  return { plan: current, placed, forced, refused };
}
