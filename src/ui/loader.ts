import { t } from "../core/i18n";
import { loadCatalog, loadMapData } from "../core/dataset";
import { TerritoryEngine } from "../core/territory";
import type { Catalog, Sanctuary } from "../core/types";
import type { Drawable, Scene } from "../render/draw";
import { buildForbiddenLayer, buildProvinceLayer } from "../render/layers";
import { createScene } from "../render/scene";
import type { Bounds } from "../render/view";
import { isEco, detailMaxSide, layerMaxSide } from "./perf";
import { dataFetch, dataUrl, fileExists, readBytes } from "./platform";

export type Loaded = {
  catalog: Catalog;
  engine: TerritoryEngine;
  scene: Scene;
  /** Taille de l'image servant de fond (pour l'export PNG à la même résolution). */
  imagePixels: [number, number];
  customImage: boolean;
  /** Mode économe actif au chargement. */
  eco: boolean;
  /** Recharge l'image de fond en pleine résolution (export) quand elle a été réduite en mode économe. */
  loadFullDetail?: () => Promise<ImageBitmap>;
  warnings: string[];
  /** Sanctuaires saisis pour cette carte (fichier overrides.json de la carte). */
  sanctuaries: Sanctuary[];
  /** Niveau (1 à 9) des portes, par position (voir passKey). */
  passLevels: Record<string, number>;
};

async function bitmap(path: string): Promise<ImageBitmap> {
  const response = await dataFetch(path);
  if (!response.ok) throw new Error(`${path} : ${response.status}`);
  return createImageBitmap(await response.blob());
}

function downscale(source: ImageBitmap, maxSide: number): Drawable {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (k === 1) return source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * k);
  canvas.height = Math.round(source.height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

type Overrides = { bounds?: Bounds; sanctuaries?: Sanctuary[]; passLevels?: Record<string, number> };

async function readOverrides(slug: string): Promise<Overrides | null> {
  try {
    if (window.rok) return (await window.rok.readOverrides(slug)) as Overrides | null;
    return JSON.parse(new TextDecoder().decode(await readBytes(`maps/${slug}/overrides.json`)));
  } catch {
    return null;
  }
}

/** Enregistre une partie des réglages propres à la carte (appli : data/maps/<carte>/overrides.json ; navigateur : localStorage). */
export async function saveMapOverrides(slug: string, patch: Partial<Overrides>): Promise<void> {
  if (window.rok) {
    const current = ((await window.rok.readOverrides(slug)) as Overrides | null) ?? {};
    await window.rok.writeOverrides(slug, { ...current, ...patch });
    return;
  }
  try {
    if (patch.sanctuaries) localStorage.setItem(`rok-sanct-${slug}`, JSON.stringify(patch.sanctuaries));
    if (patch.passLevels) localStorage.setItem(`rok-pass-${slug}`, JSON.stringify(patch.passLevels));
  } catch {
    /* stockage indisponible */
  }
}

function browserSanctuaries(slug: string): Sanctuary[] {
  try {
    const raw = JSON.parse(localStorage.getItem(`rok-sanct-${slug}`) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Charge tout ce qu'il faut pour éditer une carte : règles, zones interdites pré-rendues, image, icônes. */
export async function loadMap(slug: string, progress: (label: string, fraction: number) => void): Promise<Loaded> {
  const warnings: string[] = [];
  const eco = isEco();
  progress("Catalogue", 0.02);
  const catalog = await loadCatalog(readBytes, slug);
  progress(t("Données de la carte"), 0.08);
  const data = await loadMapData(readBytes, catalog);
  const overrides = await readOverrides(slug);
  const bounds: Bounds =
    overrides?.bounds && overrides.bounds.length === 4 && overrides.bounds.every(Number.isFinite) ? overrides.bounds : catalog.bounds;
  const effective: Catalog = { ...catalog, bounds };

  progress(t("Règles de placement"), 0.25);
  const engine = new TerritoryEngine(effective, data);

  progress("Zones interdites", 0.3);
  const forbidden = await buildForbiddenLayer(engine.forbidden.triangles, bounds, undefined, (f) => progress("Zones interdites", 0.3 + f * 0.3), layerMaxSide(eco));
  const provinces = data.province ? buildProvinceLayer(data.province) : null;

  progress("Image de la carte", 0.65);
  let detail: Drawable | undefined;
  let overview: Drawable | undefined;
  let imagePixels: [number, number] = catalog.pixelSize;
  let customImage = false;
  let loadFullDetail: (() => Promise<ImageBitmap>) | undefined;
  if (await fileExists(`maps/${slug}/map.png`)) {
    try {
      const image = await bitmap(`maps/${slug}/map.png`);
      imagePixels = [image.width, image.height];
      overview = downscale(image, 1024);
      const cap = detailMaxSide(eco);
      if (Math.max(image.width, image.height) > cap) {
        detail = downscale(image, cap);
        image.close();
        loadFullDetail = () => bitmap(`maps/${slug}/map.png`);
      } else detail = image;
      customImage = true;
    } catch (e) {
      warnings.push(`map.png illisible (${(e as Error).message}).`);
    }
  }
  if (!detail) {
    try {
      overview = await bitmap(`maps/${slug}/overview.webp`);
      detail = await bitmap(`maps/${slug}/detail.webp`).catch(() => overview);
      imagePixels = [detail!.width, detail!.height];
    } catch {
      warnings.push(t("Aucune image : déposez votre PNG dans data/maps/{slug}/map.png (zones et règles restent actives).",{slug}));
    }
  }

  progress(t("Icônes"), 0.85);
  const sprites = new Map<string, Drawable>();
  const names = new Set([
    ...Object.values(catalog.structureIcons ?? {}),
    ...Object.values(catalog.buildingIcons ?? {}),
    ...Object.values(catalog.siteIcons ?? {}),
  ]);
  await Promise.all([...names].map(async (name) => {
    try {
      sprites.set(name, await bitmap(`sprites/${name}`));
    } catch {
      /* icône absente : un repère de couleur la remplace */
    }
  }));

  progress(t("Prêt"), 1);
  const scene = createScene(engine, { detail, overview, sprites, forbidden, provinces }, bounds);
  const sanctuaries = (Array.isArray(overrides?.sanctuaries) ? overrides!.sanctuaries! : window.rok ? [] : browserSanctuaries(slug)).filter(
    (q) => q && typeof q.x === "number" && typeof q.y === "number" && typeof q.bonus === "string"
  );
  let passLevels: Record<string, number> = overrides?.passLevels ?? {};
  if (!window.rok && !overrides?.passLevels) {
    try {
      passLevels = JSON.parse(localStorage.getItem(`rok-pass-${slug}`) ?? "{}");
    } catch {
      passLevels = {};
    }
  }
  return { catalog: effective, engine, scene, imagePixels, customImage, eco, loadFullDetail, warnings, sanctuaries, passLevels };
}
