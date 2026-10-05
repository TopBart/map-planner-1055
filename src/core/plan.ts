import { t } from "./i18n";
import { type Alliance, type Annotation, type Building, type Plan, type Point, type Route, PALETTE } from "./types";

/** Limites identiques à celles de l'API de ROK Battles : un plan reste partageable avec le site. */
export const LIMITS = { alliances: 16, annotations: 5000, buildings: 20000, texts: 128 } as const;

const KINDS = new Set(["flag", "center-fortress", "fortress", "horse"]);
const ANNOTATIONS = new Set(["line", "arrow", "circle", "text", "marker"]);

function fail(message: string): never {
  throw new Error(t("Plan invalide : {message}", { message }));
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, name: string, max = 500): string => {
  if (typeof v !== "string" || v.length > max) fail(t("{name} doit être un texte de {max} caractères maximum",{name,max}));
  return v;
};
const num = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(t("{name} doit être un nombre",{name}));
  return v;
};

/** Valide et nettoie un plan lu depuis un fichier ou le presse-papiers. */
export function parsePlan(input: unknown): Plan {
  if (!isRecord(input)) fail(t("le contenu n'est pas un objet JSON"));
  if (input.version !== 2) fail(t("seule la version 2 est prise en charge"));
  const map = str(input.map, t("carte"), 120);
  const mode = input.mode === "baulur" ? "baulur" : "territory";
  if (!Array.isArray(input.alliances) || input.alliances.length > LIMITS.alliances) fail(t("liste d'alliances invalide"));
  const alliances: Alliance[] = input.alliances.map((raw, i) => {
    if (!isRecord(raw)) fail(t("alliance {n}", { n: i + 1 }));
    const color = str(raw.color, t("couleur"), 9);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(t("couleur de l'alliance {n}", { n: i + 1 }));
    return { id: str(raw.id, t("id d'alliance"), 64), name: str(raw.name, t("nom d'alliance"), 80), color };
  });
  const allianceIds = new Set(alliances.map((a) => a.id));
  if (allianceIds.size !== alliances.length) fail(t("identifiants d'alliance en double"));

  const rawBuildings = Array.isArray(input.buildings) ? input.buildings : [];
  if (rawBuildings.length > LIMITS.buildings) fail(t("trop de bâtiments"));
  const buildings: Building[] = rawBuildings.map((raw, i) => {
    if (!isRecord(raw)) fail(t("bâtiment {n}",{n:i + 1}));
    const kind = str(raw.kind, t("type de bâtiment"), 32);
    if (!KINDS.has(kind)) fail(t("type de bâtiment inconnu « {kind} »",{kind}));
    const allianceId = str(raw.allianceId, t("alliance du bâtiment"), 64);
    if (!allianceIds.has(allianceId)) fail(t("bâtiment rattaché à une alliance inexistante"));
    return {
      id: str(raw.id, t("id de bâtiment"), 64),
      kind: kind as Building["kind"],
      allianceId,
      x: num(raw.x, "x"),
      y: num(raw.y, "y"),
    };
  });

  const rawAnnotations = Array.isArray(input.annotations) ? input.annotations : [];
  if (rawAnnotations.length > LIMITS.annotations) fail(t("trop d'annotations"));
  const annotations: Annotation[] = rawAnnotations.map((raw, i) => {
    if (!isRecord(raw)) fail(t("annotation {n}", { n: i + 1 }));
    const kind = str(raw.kind, t("type d'annotation"), 16);
    if (!ANNOTATIONS.has(kind)) fail(t("type d'annotation inconnu « {kind} »",{kind}));
    if (!Array.isArray(raw.points) || raw.points.length < 1 || raw.points.length > 4096) fail(t("points d'annotation"));
    const points = raw.points.map((p): Point => {
      if (!Array.isArray(p) || p.length !== 2) fail(t("point d'annotation"));
      return [num(p[0], "x"), num(p[1], "y")];
    });
    const annotation: Annotation = {
      id: str(raw.id, t("id d'annotation"), 64),
      kind: kind as Annotation["kind"],
      points,
      color: str(raw.color, t("couleur d'annotation"), 9),
      width: Math.max(1, Math.min(8, Math.round(num(raw.width, t("épaisseur"))))),
    };
    if (typeof raw.text === "string") annotation.text = raw.text.slice(0, 500);
    return annotation;
  });
  if (annotations.filter((a) => a.kind === "text").length > LIMITS.texts) fail(t("trop de textes"));

  const routes: Route[] = Array.isArray(input.routes) ? (input.routes as Route[]) : [];
  return { version: 2, map, mode, alliances, annotations, buildings, routes };
}

/** Historique annuler/rétablir par instantanés immuables (peu coûteux : on partage les sous-objets). */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(
    public present: T,
    private readonly depth = 200
  ) {}
  push(next: T): void {
    if (next === this.present) return;
    this.past.push(this.present);
    if (this.past.length > this.depth) this.past.shift();
    this.present = next;
    this.future = [];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  undo(): T {
    const previous = this.past.pop();
    if (previous !== undefined) {
      this.future.push(this.present);
      this.present = previous;
    }
    return this.present;
  }
  redo(): T {
    const next = this.future.pop();
    if (next !== undefined) {
      this.past.push(this.present);
      this.present = next;
    }
    return this.present;
  }
  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.present = value;
  }
}

export function updateSelection(previous: ReadonlySet<string>, id: string, additive: boolean): Set<string> {
  if (!additive) return new Set([id]);
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function nextAllianceColor(alliances: readonly Alliance[]): string {
  return PALETTE.find((c) => !alliances.some((a) => a.color.toUpperCase() === c)) ?? PALETTE[alliances.length % PALETTE.length];
}
