import { t } from "./i18n";
/** Sanctuaires : bonus, saisie rapide, totaux, classeur Excel (format « nom du bonus / valeur / position x / position Y »). */
import { toGame, toReal } from "./coords";
import { cellKey, TERRITORY_UNIT, type TerritoryOwnership } from "./geometry";
import type { Plan, Sanctuary } from "./types";

export type StatDef = { key: string; label: string };
/** Statistiques élémentaires données par un sanctuaire (une icône chacune). */
export const STATS: StatDef[] = [
  { key: "harvest", get label() { return t("Vitesse de récolte"); } },
  { key: "exp", get label() { return t("Gain d'exp de commandant"); } },
  { key: "attack", get label() { return t("Attaque des troupes"); } },
  { key: "rally", get label() { return t("Attaque des troupes en rassemblement"); } },
  { key: "health", get label() { return t("Santé des troupes"); } },
  { key: "defense", get label() { return t("Défense des troupes"); } },
  { key: "production", get label() { return t("Production de ressources"); } },
  { key: "build", get label() { return t("Vitesse de construction"); } },
  { key: "march", get label() { return t("Vitesse de marche"); } },
  { key: "research", get label() { return t("Vitesse de recherche"); } },
  { key: "training", get label() { return t("Vitesse d'entraînement"); } },
  { key: "ap", get label() { return t("Restauration de points d'action"); } },
  { key: "heal", get label() { return t("Vitesse de soin"); } },
];
export const statLabel = (key: string) => STATS.find((s) => s.key === key)?.label ?? key;

export type BonusPart = { stat: string; value: number };
export type BonusDef = {
  key: string;
  label: string;
  short: string;
  color: string;
  /** Touche de saisie rapide. */
  hotkey: string;
  /** Une ou deux statistiques (sanctuaires à double bonus). */
  parts: BonusPart[];
  /** Valeur de la première statistique (compatibilité). */
  value: number;
};

const single = (key: string, short: string, color: string, hotkey: string, value: number): BonusDef => ({
  key, get label() { return statLabel(key); }, short, color, hotkey, parts: [{ stat: key, value }], value,
});
const combo = (key: string, label: string, short: string, color: string, hotkey: string, parts: BonusPart[]): BonusDef => ({
  key, get label() { return t(label); }, short, color, hotkey, parts, value: parts[0].value,
});

/** Bonus de sanctuaire : valeurs par défaut relevées dans le jeu et dans le fichier de l'utilisateur. */
export const BONUSES: BonusDef[] = [
  single("harvest", "RÉ", "#2e9e4f", "1", 0.05),
  single("exp", "XP", "#8e5bd6", "2", 0.1),
  single("attack", "AT", "#d94a3d", "3", 0.03),
  single("health", "SA", "#e0719b", "4", 0.02),
  single("production", "PR", "#d9a21b", "5", 0.1),
  single("build", "CO", "#8a6a4a", "6", 0.05),
  single("march", "MA", "#2b9bc4", "7", 0.05),
  single("research", "RE", "#3f5fd1", "8", 0.05),
  single("defense", "DÉ", "#6b7b8c", "9", 0.03),
  single("training", "EN", "#e07a2d", "0", 0.05),
  combo("def-health", "Défense + Santé des troupes (3 % + 3 %)", "DS", "#3a8fb7", "a", [{ stat: "defense", value: 0.03 }, { stat: "health", value: 0.03 }]),
  combo("rally-harvest", "Attaque en rassemblement + Vitesse de récolte (5 % + 5 %)", "RR", "#b03a3a", "z", [{ stat: "rally", value: 0.05 }, { stat: "harvest", value: 0.05 }]),
  combo("attack-training", "Attaque des troupes + Vitesse d'entraînement (3 % + 10 %)", "AE", "#c4642d", "e", [{ stat: "attack", value: 0.03 }, { stat: "training", value: 0.1 }]),
  combo("ap-heal", "Restauration de points d'action + Vitesse de soin (20 % + 20 %)", "PS", "#c49a2b", "r", [{ stat: "ap", value: 0.2 }, { stat: "heal", value: 0.2 }]),
];

export const bonusByKey = (key: string): BonusDef | undefined => BONUSES.find((b) => b.key === key);
export const bonusByHotkey = (key: string): BonusDef | undefined => BONUSES.find((b) => b.hotkey === key.toLowerCase());

/** Statistiques effectives d'un sanctuaire (la valeur enregistrée ne s'applique qu'aux bonus simples). */
export function sanctuaryStats(s: Sanctuary): BonusPart[] {
  const def = bonusByKey(s.bonus);
  if (!def) return [];
  return def.parts.length === 1 ? [{ stat: def.parts[0].stat, value: s.value || def.value }] : def.parts;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const ALIASES: [string, string[]][] = [
  ["harvest", ["recolte", "gather", "harvest"]],
  ["exp", ["exp", "experience", "xp"]],
  ["attack", ["attaque", "attack"]],
  ["health", ["sante", "health", "hp"]],
  ["production", ["production"]],
  ["build", ["construction", "building", "build"]],
  ["march", ["marche", "march"]],
  ["research", ["recherche", "research"]],
  ["defense", ["defense", "defence"]],
  ["training", ["entrainement", "training"]],
];

/** Retrouve la clé de bonus d'un libellé libre (accents, casse et variantes tolérés ; doubles bonus reconnus). */
export function bonusKeyFromName(name: string): string | null {
  const f = fold(name);
  if (!f) return null;
  const has = (...w: string[]) => w.some((x) => f.includes(x));
  // « Rassemblement » n'existe qu'en double bonus avec la récolte : seul, il est signalé plutôt que pris pour une attaque simple.
  if (has("rassemblement", "rally")) return has("recolte", "gather", "harvest") ? "rally-harvest" : null;
  if (has("restauration", "points d action", "action point") && has("soin", "heal")) return "ap-heal";
  if (has("defense", "defence") && has("sante", "health")) return "def-health";
  if (has("attaque", "attack") && has("entrainement", "training")) return "attack-training";
  for (const [key, words] of ALIASES) if (words.some((w) => f.split(" ").includes(w) || f.includes(w))) return key;
  return null;
}

export const gameToWorld = (g: number) => toReal(g);

/** Totaux par statistique ; `owned` ne retient que les sanctuaires situés dans le territoire de l'alliance. */
export function sanctuaryTotals(
  list: readonly Sanctuary[],
  owned?: { ownership: TerritoryOwnership; allianceId: string }
): { totals: Map<string, number>; counts: Map<string, number>; used: number } {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  let used = 0;
  for (const s of list) {
    if (owned) {
      const owner = owned.ownership.get(cellKey(Math.floor(s.x / TERRITORY_UNIT), Math.floor(s.y / TERRITORY_UNIT)));
      if (owner?.allianceId !== owned.allianceId) continue;
    }
    used++;
    for (const part of sanctuaryStats(s)) {
      totals.set(part.stat, Math.round(((totals.get(part.stat) ?? 0) + part.value) * 1e6) / 1e6);
      counts.set(part.stat, (counts.get(part.stat) ?? 0) + 1);
    }
  }
  return { totals, counts, used };
}

export type SanctuaryGroup = { def: BonusDef; count: number; totals: number[] };

/** Regroupe par type de bonus : un sanctuaire à double bonus reste sur une seule ligne (un total par statistique). */
export function sanctuaryGroups(
  list: readonly Sanctuary[],
  owned?: { ownership: TerritoryOwnership; allianceId: string }
): SanctuaryGroup[] {
  const groups = new Map<string, SanctuaryGroup>();
  for (const s of list) {
    if (owned) {
      const owner = owned.ownership.get(cellKey(Math.floor(s.x / TERRITORY_UNIT), Math.floor(s.y / TERRITORY_UNIT)));
      if (owner?.allianceId !== owned.allianceId) continue;
    }
    const def = bonusByKey(s.bonus);
    if (!def) continue;
    const g = groups.get(def.key) ?? { def, count: 0, totals: def.parts.map(() => 0) };
    g.count++;
    sanctuaryStats(s).forEach((p, i) => (g.totals[i] = Math.round((g.totals[i] + p.value) * 1e6) / 1e6));
    groups.set(def.key, g);
  }
  return BONUSES.flatMap((b) => (groups.has(b.key) ? [groups.get(b.key)!] : []));
}

export const formatPercents = (values: readonly number[]) => values.map((v) => `+${Math.round(v * 1000) / 10} %`).join(" / ");

/** Ajoute ou met à jour (même position) ; renvoie la nouvelle liste. */
export function mergeSanctuaries(
  existing: readonly Sanctuary[],
  incoming: { bonus: string; value: number; x: number; y: number }[],
  uid: () => string
): { list: Sanctuary[]; added: number; updated: number } {
  const list = [...existing];
  let added = 0, updated = 0;
  for (const s of incoming) {
    const at = list.findIndex((e) => toGame(e.x) === toGame(s.x) && toGame(e.y) === toGame(s.y));
    if (at >= 0) {
      list[at] = { ...list[at], bonus: s.bonus, value: s.value };
      updated++;
    } else {
      list.push({ id: uid(), ...s });
      added++;
    }
  }
  return { list, added, updated };
}

/** Clé d'une porte (structure) dans `passLevels` : position interne arrondie. */
export const passKey = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;
