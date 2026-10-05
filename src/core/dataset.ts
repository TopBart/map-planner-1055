import { t } from "./i18n";
import { decodeJsonContainer } from "./container";
import type { Catalog, MapData, MapSummary, MeshDefinition, MeshInstance, ProvinceGrid, ResourcePoint, Site } from "./types";

/** Source d'octets : fetch() sur le protocole local en appli, lecture de fichiers en test. */
export type ByteSource = (path: string) => Promise<Uint8Array>;

const CATEGORIES = new Set(["structures", "forbidden", "rss", "province", "bastions", "caves", "villages"]);

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join("");
}

async function readJson<T>(read: ByteSource, path: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await read(path))) as T;
}

export async function loadMapList(read: ByteSource): Promise<MapSummary[]> {
  const list = await readJson<{ maps: MapSummary[] }>(read, "maps.json");
  return [...list.maps].sort((a, b) => a.order - b.order);
}

export async function loadCatalog(read: ByteSource, slug: string): Promise<Catalog> {
  const catalog = await readJson<Catalog>(read, `maps/${slug}/catalog.json`);
  if (catalog.map !== slug) throw new Error(t("Le catalogue ne correspond pas à la carte demandée."));
  if (catalog.schemaVersion !== 2) throw new Error(t("Version de catalogue non gérée : {v}",{v:String(catalog.schemaVersion)}));
  return catalog;
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** La grille de provinces est un tableau d'identifiants (ou une variante compacte tolérée). */
function normalizeProvince(value: Record<string, unknown>): ProvinceGrid {
  const width = Number(value.width);
  const height = Number(value.height);
  const cellSize = Number(value.cellSize);
  if (!(width > 0 && height > 0 && cellSize > 0)) throw new Error(t("Grille de provinces : dimensions invalides."));
  const expected = width * height;
  const raw = value.cells;
  let cells: Uint8Array;
  if (typeof raw === "string") cells = fromBase64(raw);
  else if (Array.isArray(raw) && raw.length === expected) cells = Uint8Array.from(raw as number[]);
  else if (Array.isArray(raw) && raw.every((r) => Array.isArray(r) && r.length === 2)) {
    cells = new Uint8Array(expected);
    let at = 0;
    for (const [run, id] of raw as [number, number][]) {
      cells.fill(id, at, at + run);
      at += run;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    cells = Uint8Array.from(Object.values(raw as Record<string, number>));
  } else throw new Error("Grille de provinces : format de cellules inconnu (lancez « npm run inspect-data »).");
  if (cells.length !== expected) throw new Error(`Grille de provinces : ${cells.length} cellules au lieu de ${expected}.`);
  return {
    cellSize,
    width,
    height,
    cells,
    flagBlocked: new Set((value.flagBlocked as number[]) ?? []),
    fortressBlocked: new Set((value.fortressBlocked as number[]) ?? []),
  };
}

type CategoryFile = { gameMap?: string; category?: string } & Record<string, unknown>;

/** Charge et décode les catégories d'une carte, une par une pour limiter le pic mémoire. */
export async function loadMapData(read: ByteSource, catalog: Catalog): Promise<MapData> {
  const data: MapData = { sites: [], landmarks: [], resources: [], definitions: [], instances: [], province: null };
  for (const category of catalog.categories) {
    if (!CATEGORIES.has(category)) continue;
    const bytes = await read(`maps/${catalog.map}/${category}.bin`);
    const expected = catalog.assets?.[`${category}.bin`];
    if (expected) {
      if (expected.bytes !== bytes.byteLength) throw new Error(t("{category}.bin : taille différente du catalogue.",{category}));
      if ((await sha256Hex(bytes)) !== expected.sha256) throw new Error(t("{category}.bin : empreinte différente du catalogue.",{category}));
    }
    const value = decodeJsonContainer<CategoryFile>(bytes);
    if (value.gameMap !== catalog.map || value.category !== category)
      throw new Error(`${category}.bin : le fichier ne correspond pas à la carte ${catalog.map}.`);
    if (category === "forbidden") {
      data.definitions = value.definitions as MeshDefinition[];
      data.instances = value.instances as MeshInstance[];
    } else if (category === "rss") data.resources = value.points as ResourcePoint[];
    else if (category === "province") data.province = normalizeProvince(value);
    else {
      const points = (value.points as Array<Omit<Site, "id"> & { id: number }>).map((p) => ({
        ...p,
        id: `${category}:${p.id}`,
      }));
      (category === "caves" || category === "villages" ? data.landmarks : data.sites).push(...points);
    }
  }
  return data;
}
