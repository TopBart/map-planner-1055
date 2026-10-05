import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { TerritoryEngine } from "../src/core/territory";
import type { Building, MapData, Plan } from "../src/core/types";
import { drawScene, DEFAULT_VISIBILITY, type FrameState, renderToSurface } from "../src/render/draw";
import { pickAt } from "../src/render/hit";
import { buildForbiddenLayer, buildProvinceLayer, type SurfaceFactory } from "../src/render/layers";
import { createScene, overviewsFor } from "../src/render/scene";
import { fitView, panView, screenToWorld, worldToScreen, zoomView } from "../src/render/view";
import { makeCatalog, makeData } from "./fixture";

const OUT = process.env.RENDER_OUT ?? join(tmpdir(), "rok-render");
mkdirSync(OUT, { recursive: true });
const make: SurfaceFactory = (w, h) => createCanvas(w, h) as never;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Fausse carte : herbe, quadrillage et cadre décoratif de 60 unités autour de la zone jouable. */
function fakeMapImage(width: number, height: number, bounds: [number, number, number, number], native: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#a3b259";
  ctx.fillRect(0, 0, width, height);
  const kx = width / (bounds[2] - bounds[0]);
  const ky = height / (bounds[3] - bounds[1]);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  for (let v = 0; v <= native; v += 100) {
    ctx.beginPath();
    ctx.moveTo((v - bounds[0]) * kx, 0);
    ctx.lineTo((v - bounds[0]) * kx, height);
    ctx.moveTo(0, (bounds[3] - v) * ky);
    ctx.lineTo(width, (bounds[3] - v) * ky);
    ctx.stroke();
  }
  ctx.strokeStyle = "#c9d4d8";
  ctx.lineWidth = (60 * kx) / 1;
  ctx.strokeRect(((-60 - bounds[0]) * kx) / 1 + (60 * kx) / 2, ((bounds[3] - 660) * ky) + (60 * ky) / 2, (720 - 60) * kx, (720 - 60) * ky);
  return canvas;
}

function sprite(color: string, size = 32) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.stroke();
  return canvas;
}

async function buildFixtureScene(extraTriangles = 0) {
  const catalog = makeCatalog();
  const data: MapData = makeData();
  const random = rng(7);
  for (let i = 0; i < extraTriangles; i++) {
    const base = data.definitions[0].vertices.length;
    const x = random() * 560;
    const y = random() * 560;
    data.definitions[0].vertices.push([x, y], [x + 25 + random() * 30, y + 6], [x + 6, y + 25 + random() * 30]);
    data.definitions[0].indices.push(base, base + 1, base + 2);
  }
  for (let i = 0; i < 3000; i++)
    data.resources.push({ id: 100 + i, kind: (["food", "wood", "stone", "coin", "crystal"] as const)[i % 5], x: random() * 600, y: random() * 600 });
  const engine = new TerritoryEngine(catalog, data);
  const forbidden = await buildForbiddenLayer(engine.forbidden.triangles, catalog.bounds, make);
  const sprites = new Map<string, { width: number; height: number }>();
  const assets = {
    detail: fakeMapImage(2880, 2880, catalog.bounds, 600) as never,
    overview: fakeMapImage(720, 720, catalog.bounds, 600) as never,
    sprites,
    forbidden,
    provinces: buildProvinceLayer(data.province!, make),
  };
  return { catalog, data, engine, scene: createScene(engine, assets, catalog.bounds, make), sprites };
}

function planWith(buildings: Building[]): Plan {
  return {
    version: 2,
    map: "Demo_Map_v1",
    mode: "territory",
    alliances: [
      { id: "alliance-1", name: "ROKB", color: "#00DEFF" },
      { id: "alliance-2", name: "FR01", color: "#FF8A00" },
    ],
    buildings,
    routes: [],
    annotations: [
      { id: "a1", kind: "arrow", points: [[120, 220], [260, 300]], color: "#FFFC00", width: 2 },
      { id: "a2", kind: "circle", points: [[430, 160], [470, 160]], color: "#FF4DBE", width: 2 },
      { id: "a3", kind: "line", points: [[60, 500], [250, 520]], color: "#00FF5A", width: 2 },
      { id: "a4", kind: "text", points: [[400, 420]], color: "#FFFFFF", width: 2, text: "Rally ici" },
      { id: "a5", kind: "marker", points: [[330, 120]], color: "#B400FF", width: 2 },
    ],
  };
}

const b = (kind: Building["kind"], allianceId: string, x: number, y: number, id: string): Building => ({ id, kind, allianceId, x, y });

async function frame(name: string, zoomFactor: number, center: [number, number], state: Partial<FrameState> = {}) {
  const { scene, catalog } = await buildFixtureScene(120);
  const buildings = [
    b("fortress", "alliance-1", 100, 400, "f1"),
    b("flag", "alliance-1", 100, 454, "g1"),
    b("flag", "alliance-1", 154, 400, "g2"),
    b("fortress", "alliance-2", 450, 450, "f2"),
    b("flag", "alliance-2", 450, 504, "g3"),
  ];
  const plan = planWith(buildings);
  let view = fitView(1100, 760, catalog.bounds);
  view = zoomView(view, zoomFactor, 550, 380, catalog.bounds);
  view = { ...view, cx: center[0], cy: center[1] };
  const canvas = createCanvas(1100, 760);
  const ctx = canvas.getContext("2d");
  const t0 = performance.now();
  drawScene(ctx, scene, { plan, selected: new Set(["f1", "a3"]), visibility: { ...DEFAULT_VISIBILITY, provinces: name === "provinces" }, ...state }, view, overviewsFor(scene.engine, plan.buildings));
  const ms = performance.now() - t0;
  writeFileSync(join(OUT, `${name}.png`), canvas.toBuffer("image/png"));
  return { canvas, ms, scene, plan, view, catalog };
}

describe("rendu", () => {
  it("dessine la vue d'ensemble : carte, bordures, territoires, annotations", async () => {
    const { canvas } = await frame("overview", 1, [300, 300]);
    const px = canvas.getContext("2d").getImageData(550, 380, 1, 1).data;
    expect(px[3]).toBe(255);
  });

  it("dessine les zones interdites hachurées, les ressources et la prévisualisation de pose", async () => {
    const { ms } = await frame("zoomed", 4.5, [200, 250], {
      placement: { kind: "flag", allianceId: "alliance-1", x: 190, y: 360, legal: true },
    });
    expect(ms).toBeLessThan(2000);
  });

  it("affiche l'aperçu de pose illégale en rouge et le tracé en cours", async () => {
    await frame("illegal", 6, [220, 70], {
      placement: { kind: "fortress", allianceId: "alliance-1", x: 212, y: 62, legal: false },
      draft: { kind: "arrow", points: [[180, 40], [260, 120]], color: "#FF0000", width: 2 },
    });
  });

  it("affiche les provinces interdites sur demande", async () => {
    await frame("provinces", 1, [300, 300]);
  });

  it("exporte toute la carte sans surbrillance ni aperçu", async () => {
    const { scene } = await buildFixtureScene(120);
    const plan = planWith([b("fortress", "alliance-1", 100, 400, "f1"), b("flag", "alliance-1", 154, 400, "g2")]);
    const surface = renderToSurface(scene, { plan, selected: new Set(["f1"]), visibility: DEFAULT_VISIBILITY, placement: { kind: "flag", allianceId: "alliance-1", x: 10, y: 10, legal: true } }, 1440, 1440, overviewsFor(scene.engine, plan.buildings), make) as never as ReturnType<typeof createCanvas>;
    writeFileSync(join(OUT, "export.png"), (surface as never as { toBuffer(t: string): Buffer }).toBuffer("image/png"));
    expect(surface.width).toBe(1440);
  });

  it("tient la charge : forbidden de 60 000 triangles, 3 000 ressources, 1 000 bâtiments", async () => {
    const { scene, catalog, engine } = await buildFixtureScene(60000);
    const buildings: Building[] = [b("fortress", "alliance-1", 100, 400, "root")];
    const random = rng(3);
    for (let i = 0; i < 999; i++) buildings.push(b("flag", "alliance-1", 40 + random() * 520, 40 + random() * 520, `x${i}`));
    const plan = { ...planWith(buildings), annotations: [] };
    const canvas = createCanvas(1400, 900);
    const ctx = canvas.getContext("2d");
    let view = fitView(1400, 900, catalog.bounds);
    view = zoomView(view, 6, 700, 450, catalog.bounds);
    const overviews = overviewsFor(engine, plan.buildings);
    drawScene(ctx, scene, { plan, selected: new Set(), visibility: DEFAULT_VISIBILITY }, view, overviews); // échauffement
    const runs = 15;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      view = panView(view, 12, 5);
      drawScene(ctx, scene, { plan, selected: new Set(), visibility: DEFAULT_VISIBILITY }, view, overviews);
    }
    const perFrame = (performance.now() - t0) / runs;
    console.log(`image moyenne (rendu logiciel Skia, sans GPU) : ${perFrame.toFixed(1)} ms ; ${engine.forbidden.count} triangles interdits`);
    // Les vérifications de pose restent instantanées malgré 60 000 triangles.
    const t1 = performance.now();
    for (let i = 0; i < 2000; i++) engine.forbidden.circleHits(random() * 600, random() * 600, 3);
    const query = (performance.now() - t1) / 2000;
    console.log(`requête de collision : ${(query * 1000).toFixed(1)} µs`);
    expect(query).toBeLessThan(1);
    expect(perFrame).toBeLessThan(250);
  }, 60000);

  it("repère les éléments sous le pointeur et garde un repère monde cohérent", async () => {
    const { catalog } = await buildFixtureScene();
    const plan = planWith([b("fortress", "alliance-1", 100, 400, "f1")]);
    const view = fitView(1100, 760, catalog.bounds);
    const [sx, sy] = worldToScreen(view, 100, 400);
    expect(pickAt(plan, view, catalog.bounds, sx + 3, sy - 2)).toBe("f1");
    expect(pickAt(plan, view, catalog.bounds, sx + 80, sy)).toBeUndefined();
    const [wx, wy] = screenToWorld(view, sx, sy);
    expect(wx).toBeCloseTo(100, 6);
    expect(wy).toBeCloseTo(400, 6);
    const [ax, ay] = worldToScreen(view, 120, 220);
    const [bx, by] = worldToScreen(view, 260, 300);
    expect(pickAt(plan.annotations.length ? plan : plan, view, catalog.bounds, (ax + bx) / 2, (ay + by) / 2)).toBe("a1");
  });
});
