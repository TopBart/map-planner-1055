import { appendFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { describe, it } from "vitest";
import { TerritoryEngine } from "../src/core/territory";
import type { Building, MapData } from "../src/core/types";
import { DEFAULT_VISIBILITY, drawScene } from "../src/render/draw";
import { buildForbiddenLayer, type SurfaceFactory } from "../src/render/layers";
import { createScene, overviewsFor } from "../src/render/scene";
import { fitView, panView, zoomView } from "../src/render/view";
import { makeCatalog, makeData } from "./fixture";

const make: SurfaceFactory = (w, h) => createCanvas(w, h) as never;
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

describe.skipIf(!process.env.PROFILE)("profil", () => {
  it("mesure chaque couche", async () => {
    const catalog = makeCatalog();
    const data: MapData = makeData();
    const random = rng(7);
    for (let i = 0; i < 60000; i++) {
      const base = data.definitions[0].vertices.length;
      const x = random() * 560, y = random() * 560;
      data.definitions[0].vertices.push([x, y], [x + 25 + random() * 30, y + 6], [x + 6, y + 25 + random() * 30]);
      data.definitions[0].indices.push(base, base + 1, base + 2);
    }
    for (let i = 0; i < 3000; i++) data.resources.push({ id: 100 + i, kind: (["food", "wood", "stone", "coin", "crystal"] as const)[i % 5], x: random() * 600, y: random() * 600 });
    const engine = new TerritoryEngine(catalog, data);
    const forbidden = await buildForbiddenLayer(engine.forbidden.triangles, catalog.bounds, make);
    const image = (n: number) => { const c = createCanvas(n, n); const x = c.getContext("2d"); x.fillStyle = "#a3b259"; x.fillRect(0, 0, n, n); return c as never; };
    const build = (withImages: boolean) => createScene(engine, { detail: withImages ? image(4096) : undefined, overview: withImages ? image(1024) : undefined, sprites: new Map(), forbidden }, catalog.bounds, make);
    const buildings: Building[] = [{ id: "root", kind: "fortress", allianceId: "alliance-1", x: 100, y: 400 }];
    for (let i = 0; i < 999; i++) buildings.push({ id: `x${i}`, kind: "flag", allianceId: "alliance-1", x: 40 + random() * 520, y: 40 + random() * 520 });
    const plan = { version: 2 as const, map: "m", mode: "territory" as const, alliances: [{ id: "alliance-1", name: "ROKB", color: "#00DEFF" }], buildings, annotations: [], routes: [] };
    const overviews = overviewsFor(engine, plan.buildings);
    const measure = (label: string, scene: ReturnType<typeof build>, patch: object, zoom: number) => {
      const canvas = createCanvas(1400, 900); const ctx = canvas.getContext("2d");
      let view = zoomView(fitView(1400, 900, catalog.bounds), zoom, 700, 450, catalog.bounds);
      const state = { plan: label.includes("sans bâtiments") ? { ...plan, buildings: [] } : plan, selected: new Set<string>(), visibility: { ...DEFAULT_VISIBILITY, ...patch } };
      const ov = label.includes("sans bâtiments") ? new Map() : overviews;
      drawScene(ctx, scene, state, view, ov);
      const t0 = performance.now();
      for (let i = 0; i < 12; i++) { view = panView(view, 9, 4); drawScene(ctx, scene, state, view, ov); }
      appendFileSync(process.env.PROFILE_OUT ?? "/tmp/profile.txt", `${label.padEnd(44)} ${((performance.now() - t0) / 12).toFixed(1)} ms\n`);
    };
    for (const zoom of [1, 6]) {
      appendFileSync(process.env.PROFILE_OUT ?? "/tmp/profile.txt", `--- zoom ${zoom}x\n`);
      measure("tout", build(true), {}, zoom);
      measure("sans image de carte", build(false), {}, zoom);
      measure("sans zones interdites", build(true), { forbidden: false }, zoom);
      measure("sans ressources", build(true), { resources: false }, zoom);
      measure("sans bâtiments", build(true), {}, zoom);
      measure("sans bâtiments, ressources, interdites", build(false), { resources: false, forbidden: false }, zoom);
    }
  }, 120000);
});
