import { locale, t } from "../core/i18n";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, LIMITS, nextAllianceColor, parsePlan, updateSelection } from "../core/plan";
import {
  type Annotation,
  type Building,
  type BuildingKind,
  COLOR_NAMES,
  type MapSummary,
  PALETTE,
  type Plan,
  type Point,
  type Tool,
  newPlan,
} from "../core/types";
import type { Sanctuary } from "../core/types";
import { DEFAULT_VISIBILITY, type Draft, type Placement, type Visibility } from "../render/draw";
import { pickAt } from "../render/hit";
import { saveMapOverrides } from "./loader";
import { passKey } from "../core/sanctuary";
import { loadBonusIcons } from "../render/bonusIcons";
import { BONUSES, bonusByHotkey, bonusByKey, sanctuaryGroups, mergeSanctuaries } from "../core/sanctuary";
import { maxDpr, setEco } from "./perf";
import { DEFAULT_RESOURCE_RADIUS } from "../core/territory";
import { MapRenderer } from "../render/renderer";
import { toGame, toReal } from "../core/coords";
import { KIND_FR as KIND_LABELS } from "../core/labels";
import type { Warped, Raster } from "../core/overlay";
import type { Rgb } from "../core/trace";
import { TERRITORY_UNIT } from "../core/geometry";
import type { Start } from "./App";
import { LangSwitch } from "./LangSwitch";
import { AlliancesPanel, AnnotatePanel, BuildPanel, CalibrationPanel, DisplayPanel, OverlayPanel, PassPanel, SanctuaryPanel, SummaryPanel } from "./panels";
import { ExportDialog, type ExportState, ImportDialog, type ImportState, NameDialog, TextDialog } from "./dialogs";
import type { ShotPair } from "./ShotPanel";
const ShotPanel = lazy(() => import("./ShotPanel").then((m) => ({ default: m.ShotPanel })));
import type { Loaded } from "./loader";
import { dataUrl, fileExists, isDesktop, library, openBinaryFile, saveFile, saveMany } from "./platform";

const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const xlsxFilter = () => [{ name: t("Classeur Excel"), extensions: ["xlsx"] }];
const BUILD_KINDS: BuildingKind[] = ["center-fortress", "fortress", "horse", "flag"];
const ANNOTATION_TOOLS: [Tool, string][] = [
  ["line", "Ligne"],
  ["arrow", "Flèche"],
  ["circle", "Cercle"],
  ["marker", "Repère"],
  ["text", "Texte"],
];

export function Editor({ map, loaded, start, startInMapEditor, onBack, onLibrary }: { map: MapSummary; loaded: Loaded; start?: Start; startInMapEditor?: boolean; onBack: () => void; onLibrary: () => void }) {
  const { catalog, engine, scene } = loaded;
  const storageKey = `rok-plan-${map.map}`;
  const initial = useMemo(() => {
    if (start) return start.plan;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return parsePlan(JSON.parse(saved));
    } catch {
      /* sauvegarde absente ou corrompue : on repart d'un plan vide */
    }
    return newPlan(map.map);
  }, [map.map, storageKey, start]);

  const history = useRef(new History<Plan>(initial));
  const [plan, setPlan] = useState<Plan>(initial);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [activeId, setActiveId] = useState(initial.alliances[0]?.id ?? "");
  const [color, setColor] = useState(PALETTE[3]);
  const [width, setWidth] = useState(2);
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState("");
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");
  const [planName, setPlanName] = useState<string | null>(start?.name ?? null);
  const [nameDialog, setNameDialog] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [shot, setShot] = useState<{ url: string; name: string; raster: Raster } | null>(null);
  const [panel, setPanel] = useState<"off" | "points" | "pipette">("off");
  const [pairs, setPairs] = useState<ShotPair[]>([]);
  const [opacity, setOpacity] = useState(0.6);
  const [warped, setWarped] = useState<Warped | null>(null);
  const [pick, setPick] = useState<{ at: Point; rgb: Rgb } | null>(null);
  const [tol, setTol] = useState(40);
  const [cov, setCov] = useState(0.3);
  const [trace, setTrace] = useState<Set<string> | null>(null);
  const [calibMsg, setCalibMsg] = useState("");
  // Rayon de la hit box des puits : fixe (2,04, mesuré sur capture et validé).
  engine.resourceRadius = DEFAULT_RESOURCE_RADIUS;
  const [bonus, setBonus] = useState(BONUSES[0].key);
  const [eco, setEcoState] = useState(loaded.eco);
  const [exp, setExp] = useState<ExportState | null>(null);
  const [imp, setImp] = useState<ImportState | null>(null);

  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const [sanctuaries, setSanctuariesState] = useState<Sanctuary[]>(loaded.sanctuaries);
  const sanctHistory = useRef<Sanctuary[][]>([]);
  const setSanctuaries = (list: Sanctuary[]) => {
    sanctHistory.current.push(sanctuaries);
    if (sanctHistory.current.length > 100) sanctHistory.current.shift();
    setSanctuariesState(list);
    void saveMapOverrides(map.map, { sanctuaries: list });
  };
  const undoSanctuaries = () => {
    const previous = sanctHistory.current.pop();
    if (!previous) return;
    setSanctuariesState(previous);
    void saveMapOverrides(map.map, { sanctuaries: previous });
  };
  const [editorMode, setEditorMode] = useState(!!startInMapEditor);
  const [passLevels, setPassLevelsState] = useState<Record<string, number>>(loaded.passLevels);
  const [passLevel, setPassLevel] = useState(1);
  const setPassLevels = (value: Record<string, number>) => {
    setPassLevelsState(value);
    void saveMapOverrides(map.map, { passLevels: value });
  };
  const [passKinds, setPassKinds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rok-pass-kinds") ?? "null");
      if (Array.isArray(saved)) return new Set<string>(saved);
    } catch {
      /* valeur par défaut */
    }
    return new Set(engine.structures.map((st) => st.kind).filter((k) => /pass|gate|porte/i.test(k)));
  });
  const togglePassKind = (kind: string) => {
    const next = new Set(passKinds);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    setPassKinds(next);
    try {
      localStorage.setItem("rok-pass-kinds", JSON.stringify([...next]));
    } catch {
      /* sans conséquence */
    }
  };
  // Types de structures de la carte sur lesquels un sanctuaire peut être rattaché.
  const structureKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of engine.structures) m.set(st.kind, (m.get(st.kind) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [engine]);
  const [snapKinds, setSnapKinds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rok-snap-kinds") ?? "null");
      if (Array.isArray(saved)) return new Set<string>(saved);
    } catch {
      /* valeur par défaut */
    }
    const kinds = engine.structures.map((st) => st.kind);
    const named = new Set(kinds.filter((k) => /sanct|altar|shrine|temple/i.test(k)));
    return named.size ? named : new Set(kinds.filter((k) => !["pass", "bastion"].includes(k)));
  });
  const toggleSnapKind = (kind: string) => {
    const next = new Set(snapKinds);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    setSnapKinds(next);
    try {
      localStorage.setItem("rok-snap-kinds", JSON.stringify([...next]));
    } catch {
      /* sans conséquence */
    }
  };
  const [, setIconsVersion] = useState(0);
  useEffect(() => {
    void loadBonusIcons({ exists: fileExists, url: dataUrl }).then(() => {
      renderer.current?.invalidate();
      setIconsVersion((v) => v + 1);
    });
  }, []);
  const live = useRef({ plan, selected, tool, activeId, color, width, visibility, panel, pairs, bonus, sanctuaries: loaded.sanctuaries, snapKinds: new Set<string>(), passKinds: new Set<string>(), passLevel: 1, passLevels: loaded.passLevels });
  live.current = { plan, selected, tool, activeId, color, width, visibility, panel, pairs, bonus, sanctuaries, snapKinds, passKinds, passLevel, passLevels };

  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? "" : t)), 3500);
  }, []);

  const commit = useCallback((next: Plan) => {
    history.current.push(next);
    setPlan(next);
  }, []);
  const restore = useCallback((next: Plan) => {
    setPlan(next);
    setSelected((s) => new Set([...s].filter((id) => next.buildings.some((b) => b.id === id) || next.annotations.some((a) => a.id === id))));
    setActiveId((id) => (next.alliances.some((a) => a.id === id) ? id : (next.alliances[0]?.id ?? "")));
  }, []);
  const undo = useCallback(() => restore(history.current.undo()), [restore]);
  const redo = useCallback(() => restore(history.current.redo()), [restore]);

  // Rendu : création unique, puis simples mises à jour d'état.
  useEffect(() => {
    if (!canvas.current) return;
    MapRenderer.maxDpr = maxDpr(loaded.eco);
    MapRenderer.layerCache = !loaded.eco;
    const r = new MapRenderer(canvas.current, scene, { plan: live.current.plan, selected: live.current.selected, visibility: live.current.visibility, sanctuaries: live.current.sanctuaries, passLevels: live.current.passLevels }, (z) =>
      setZoom((old) => (Math.abs(old - z) > 0.01 ? z : old))
    );
    renderer.current = r;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, [scene]);
  useEffect(() => renderer.current?.update({ plan, selected, visibility, sanctuaries, passLevels }), [plan, selected, visibility, sanctuaries, passLevels]);
  useEffect(() => {
    const pins = pairs.flatMap((p, i) => (p.world ? [{ x: p.world[0], y: p.world[1], label: String(i + 1), color: "#22c55e" }] : []));
    renderer.current?.update({ overlayOpacity: warped ? opacity : 0, pins, trace });
  }, [pairs, warped, opacity, trace, scene]);

  // Sauvegarde automatique (locale) du plan.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(plan));
      } catch {
        /* quota ou stockage indisponible : sans conséquence */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [plan, storageKey]);

  const active = plan.alliances.find((a) => a.id === activeId) ?? plan.alliances[0];
  const counts = useMemo(() => {
    const c = new Map<BuildingKind, number>();
    for (const b of plan.buildings) if (b.allianceId === active?.id) c.set(b.kind, (c.get(b.kind) ?? 0) + 1);
    return c;
  }, [plan.buildings, active?.id]);
  const sanctAll = useMemo(() => sanctuaryGroups(sanctuaries), [sanctuaries]);
  const sanctOwned = useMemo(
    () => (active ? sanctuaryGroups(sanctuaries, { ownership: engine.state(plan.buildings).ownership, allianceId: active.id }) : []),
    [sanctuaries, plan.buildings, engine, active]
  );
  const summary = useMemo(() => (active ? engine.summary(plan, active.id) : null), [engine, plan, active]);

  // ---- Interactions ----
  const drag = useRef<{ mode: "pan" | "draw" | "pinch"; dist?: number; x: number; y: number; moved: boolean; start?: Point; button: number } | null>(null);

  /** Pointeurs actifs (tactile : deux doigts = zoom + déplacement). */
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [tool]);
  const pointers = useRef(new Map<number, Point>());
  const pinchStep = (r: MapRenderer, d: NonNullable<typeof drag.current>) => {
    const [a, b] = [...pointers.current.values()];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    r.pan(mx - d.x, my - d.y);
    if (d.dist) r.zoomAt(dist / d.dist, mx, my);
    d.dist = dist; d.x = mx; d.y = my;
  };

  const setHud = (text: string, bad = false) => {
    if (!hud.current) return;
    hud.current.textContent = text;
    hud.current.classList.toggle("bad", bad);
  };

  const placementAt = (sx: number, sy: number): { placement: Placement; error: string | null } | null => {
    const { tool: t, activeId: id, plan: p } = live.current;
    const r = renderer.current;
    if (!r || !BUILD_KINDS.includes(t as BuildingKind) || !id) return null;
    const [wx, wy] = r.toWorld(sx, sy);
    // Position libre dans la case : seule la boîte de collision décide si la pose est possible.
    const x = Math.round(wx * 100) / 100;
    const y = Math.round(wy * 100) / 100;
    const error = engine.placementError({ id: "preview", kind: t as BuildingKind, allianceId: id, x, y }, p);
    return { placement: { kind: t as BuildingKind, allianceId: id, x, y, legal: !error }, error };
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  /** Structure de la carte (candidate sanctuaire) la plus proche du curseur, 60 px au plus. */
  const nearestSanctuarySite = (r: MapRenderer, sx: number, sy: number) => {
    let best = 60;
    let found: { x: number; y: number; kind: string } | null = null;
    for (const st of engine.structures) {
      if (!live.current.snapKinds.has(st.kind)) continue;
      const [qx, qy] = r.toScreen(st.x, st.y);
      const dist = Math.hypot(qx - sx, qy - sy);
      if (dist < best) { best = dist; found = st; }
    }
    return found;
  };

  const nearestPass = (r: MapRenderer, sx: number, sy: number) => {
    let best = 60;
    let found: { x: number; y: number; kind: string } | null = null;
    for (const st of engine.structures) {
      if (!live.current.passKinds.has(st.kind)) continue;
      const [qx, qy] = r.toScreen(st.x, st.y);
      const dist = Math.hypot(qx - sx, qy - sy);
      if (dist < best) { best = dist; found = st; }
    }
    return found;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const r = renderer.current;
    if (!r) return;
    canvas.current!.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e);
    pointers.current.set(e.pointerId, [sx, sy]);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      r.update({ draft: null, placement: null });
      drag.current = { mode: "pinch", x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, moved: true, button: 0 };
      return;
    }
    if (pointers.current.size > 2) return;
    const { tool: t } = live.current;
    const isDraw = e.button === 0 && (t === "line" || t === "arrow" || t === "circle");
    if (isDraw) {
      const w = r.toWorld(sx, sy);
      drag.current = { mode: "draw", x: sx, y: sy, moved: false, start: w, button: 0 };
      return;
    }
    drag.current = { mode: "pan", x: sx, y: sy, moved: false, button: e.button };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = renderer.current;
    if (!r) return;
    const [sx, sy] = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [sx, sy]);
    const d = drag.current;
    if (d?.mode === "pinch" && pointers.current.size >= 2) return pinchStep(r, d);
    const [wx, wy] = r.toWorld(sx, sy);
    if (d) {
      if (Math.hypot(sx - d.x, sy - d.y) > 3) d.moved = true;
      if (d.mode === "pan" && d.moved) {
        r.pan(sx - d.x, sy - d.y);
        d.x = sx;
        d.y = sy;
        r.update({ placement: null });
      } else if (d.mode === "draw" && d.start) {
        const { tool: t, color: c, width: w } = live.current;
        const draft: Draft = { kind: t as Draft["kind"], points: [d.start, [wx, wy]], color: c, width: w };
        r.update({ draft });
      }
      return;
    }
    const preview = placementAt(sx, sy);
    r.update({ placement: preview?.placement ?? null });
    if (live.current.tool === "pass-level") {
      const site = nearestPass(r, sx, sy);
      return setHud(site ? `${t("Porte niveau {n}", { n: live.current.passLevel })} · X ${toGame(site.x)} · Y ${toGame(site.y)}${live.current.passLevels[passKey(site.x, site.y)] ? ` (${t("actuel : {n}", { n: live.current.passLevels[passKey(site.x, site.y)] })})` : ""}` : `${t("Aucune porte à proximité")} · X ${toGame(wx)} · Y ${toGame(wy)}`);
    }
    if (live.current.tool === "sanctuary") {
      const site = nearestSanctuarySite(r, sx, sy);
      return setHud(site ? `${bonusByKey(live.current.bonus)?.label} → ${t("structure « {kind} »", { kind: site.kind })} · X ${toGame(site.x)} · Y ${toGame(site.y)}` : `${t("Aucune structure à proximité")} · X ${toGame(wx)} · Y ${toGame(wy)}`);
    }
    if (preview) setHud(preview.error ?? `${KIND_LABELS[preview.placement.kind]} · X ${toGame(preview.placement.x)} · Y ${toGame(preview.placement.y)}`, !!preview.error);
    else setHud(`X ${toGame(wx)} · Y ${toGame(wy)}`);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const r = renderer.current;
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (d?.mode === "pinch") {
      if (pointers.current.size === 0) drag.current = null;
      return; // fin d'un geste à deux doigts : aucune action
    }
    drag.current = null;
    if (!r || !d) return;
    const [sx, sy] = local(e);
    const cur = live.current;
    if (d.mode === "draw" && d.start) {
      r.update({ draft: null });
      if (d.moved) {
        if (cur.plan.annotations.length >= LIMITS.annotations) return say(t("Limite d'annotations atteinte."));
        const end = r.toWorld(sx, sy);
        const a: Annotation = { id: uid(), kind: cur.tool as Annotation["kind"], points: [d.start, end], color: cur.color, width: cur.width };
        commit({ ...cur.plan, annotations: [...cur.plan.annotations, a] });
        setSelected(new Set([a.id]));
      }
      return;
    }
    if (d.moved || d.button !== 0) return; // fin d'un déplacement de la carte
    if (cur.panel === "points") {
      const pending = cur.pairs.findIndex((p) => !p.world);
      if (pending < 0) return say(t("Cliquez d'abord un repère sur la capture (à gauche)."));
      let world = r.toWorld(sx, sy);
      let best = 20; // aimantation sur une structure de la carte proche du clic (en pixels)
      for (const st of engine.structures) {
        const [qx, qy] = r.toScreen(st.x, st.y);
        const dist = Math.hypot(qx - sx, qy - sy);
        if (dist < best) {
          best = dist;
          world = [st.x, st.y];
        }
      }
      setPairs((ps) => ps.map((p, i) => (i === pending ? { ...p, world } : p)));
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (cur.tool === "select") {
      const hit = pickAt(cur.plan, r.view, scene.bounds, sx, sy);
      setSelected(hit ? updateSelection(cur.selected, hit, additive) : additive ? cur.selected : new Set());
      return;
    }
    if (BUILD_KINDS.includes(cur.tool as BuildingKind)) {
      const p = placementAt(sx, sy);
      if (!p) return;
      if (p.error) return say(p.error);
      if (cur.plan.buildings.length >= LIMITS.buildings) return say(t("Limite de bâtiments atteinte."));
      const b: Building = { id: uid(), kind: p.placement.kind, allianceId: p.placement.allianceId, x: p.placement.x, y: p.placement.y };
      commit({ ...cur.plan, buildings: [...cur.plan.buildings, b] });
      return;
    }
    if (cur.tool === "pass-level") {
      const site = nearestPass(r, sx, sy);
      if (!site) return say(t("Aucune porte à proximité : cliquez plus près d'une porte."));
      const key = passKey(site.x, site.y);
      const next = { ...cur.passLevels };
      if (e.shiftKey || next[key] === cur.passLevel) delete next[key];
      else next[key] = cur.passLevel;
      return setPassLevels(next);
    }
    if (cur.tool === "sanctuary") {
      const list = cur.sanctuaries;
      const def = bonusByKey(cur.bonus)!;
      if (e.shiftKey) {
        let near: string | null = null;
        let best = 20;
        for (const sc of list) {
          const [qx, qy] = r.toScreen(sc.x, sc.y);
          const dist = Math.hypot(qx - sx, qy - sy);
          if (dist < best) { best = dist; near = sc.id; }
        }
        if (near) setSanctuaries(list.filter((q) => q.id !== near));
        return;
      }
      const target = nearestSanctuarySite(r, sx, sy);
      let x: number, y: number;
      if (target) {
        x = target.x;
        y = target.y;
      } else if (live.current.snapKinds.size && engine.structures.some((st) => live.current.snapKinds.has(st.kind))) {
        return say(t("Aucun sanctuaire de la carte à proximité : cliquez plus près d'une structure."));
      } else {
        x = toReal(toGame(r.toWorld(sx, sy)[0]));
        y = toReal(toGame(r.toWorld(sx, sy)[1]));
      }
      const at = list.findIndex((q) => Math.hypot(q.x - x, q.y - y) < 3);
      if (at >= 0) return setSanctuaries(list.map((q, i) => (i === at ? { ...q, bonus: def.key, value: def.value } : q)));
      if (list.length >= 500) return say(t("Limite de 500 sanctuaires atteinte."));
      setSanctuaries([...list, { id: uid(), bonus: def.key, value: def.value, x, y }]);
      return;
    }
    if (cur.tool === "marker") {
      if (cur.plan.annotations.length >= LIMITS.annotations) return say(t("Limite d'annotations atteinte."));
      const a: Annotation = { id: uid(), kind: "marker", points: [r.toWorld(sx, sy)], color: cur.color, width: cur.width };
      commit({ ...cur.plan, annotations: [...cur.plan.annotations, a] });
      return;
    }
    if (cur.tool === "text") {
      setTextValue("");
      setTextAt(r.toWorld(sx, sy));
    }
  };

  const deleteSelected = useCallback(() => {
    const cur = live.current;
    if (!cur.selected.size) return;
    commit({
      ...cur.plan,
      buildings: cur.plan.buildings.filter((b) => !cur.selected.has(b.id)),
      annotations: cur.plan.annotations.filter((a) => !cur.selected.has(a.id)),
    });
    setSelected(new Set());
  }, [commit]);

  const selectAll = () => setSelected(new Set([...plan.buildings.map((b) => b.id), ...plan.annotations.map((a) => a.id)]));

  // Molette (non passive pour empêcher le défilement) et clavier.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      renderer.current?.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && live.current.tool === "pass-level" && /^[1-9]$/.test(e.key)) {
        setPassLevel(Number(e.key));
        return;
      }
      if (!mod && live.current.tool === "sanctuary") {
        const def = bonusByHotkey(e.key);
        if (def) {
          setBonus(def.key);
          return;
        }
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "Escape") {
        setTool("select");
        setSelected(new Set());
        renderer.current?.update({ placement: null, draft: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: selectAll lit l'état courant via live
  }, [undo, redo, deleteSelected, scene]);

  useEffect(() => {
    if (!BUILD_KINDS.includes(tool as BuildingKind)) renderer.current?.update({ placement: null });
  }, [tool]);

  // ---- Alliances ----
  const addAlliance = () => {
    if (plan.alliances.length >= LIMITS.alliances) return;
    const a = { id: `alliance-${uid()}`, name: `Alliance ${plan.alliances.length + 1}`, color: nextAllianceColor(plan.alliances) };
    commit({ ...plan, alliances: [...plan.alliances, a] });
    setActiveId(a.id);
  };
  const renameAlliance = (id: string, name: string) => commit({ ...plan, alliances: plan.alliances.map((a) => (a.id === id ? { ...a, name: name.slice(0, 80) } : a)) });
  const recolorAlliance = (id: string, c: string) => commit({ ...plan, alliances: plan.alliances.map((a) => (a.id === id ? { ...a, color: c } : a)) });
  const removeAlliance = (id: string) => {
    if (plan.alliances.length < 2) return;
    const next = plan.alliances.filter((a) => a.id !== id);
    commit({ ...plan, alliances: next, buildings: plan.buildings.filter((b) => b.allianceId !== id) });
    if (activeId === id) setActiveId(next[0].id);
  };

  // ---- Fichiers ----
  const writeToLibrary = async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (clean !== planName && (await library.exists(clean)) && !window.confirm(t("Un plan « {name} » existe déjà. Le remplacer ?", { name: clean }))) return;
    const id = await library.write(clean, plan);
    if (id) {
      setPlanName(id);
      say(t("Plan « {id} » enregistré.", { id }));
    } else say(t("Nom de plan invalide."));
    setNameDialog(false);
  };
  const askName = () => {
    setNameValue(planName ?? `${map.name} ${new Date().toLocaleDateString(locale())}`);
    setNameDialog(true);
  };
  const savePlan = () => (planName ? void writeToLibrary(planName) : askName());

  const resetPlan = () => {
    if (!plan.buildings.length && !plan.annotations.length && plan.alliances.length === 1) return;
    if (!window.confirm(t("Effacer le plan actuel ? (Annuler possible avec Ctrl+Z)"))) return;
    const fresh = newPlan(map.map);
    commit(fresh);
    setActiveId(fresh.alliances[0].id);
    setSelected(new Set());
  };
  const exportExcel = async () => {
    const { planToWorkbook } = await import("../core/excelPlan");
    const bytes = planToWorkbook(plan, engine);
    if (await saveFile(`${planName ?? map.map}.xlsx`, bytes, xlsxFilter())) say(t("Classeur Excel exporté."));
  };
  const exportSanctuaries = async () => {
    const { sanctuariesToWorkbook } = await import("../core/sanctuaryExcel");
    const bytes = sanctuariesToWorkbook(sanctuaries, plan, engine.state(plan.buildings).ownership);
    if (await saveFile(`sanctuaires_${map.map}.xlsx`, bytes, xlsxFilter())) say(t("Sanctuaires exportés."));
  };
  const importSanctuaries = async () => {
    const file = await openBinaryFile(xlsxFilter());
    if (!file) return;
    try {
      const { parseSanctuaryWorkbook } = await import("../core/sanctuaryExcel");
      const parsed = parseSanctuaryWorkbook(file.data);
      if (!parsed.sanctuaries.length) return say(t("Aucun sanctuaire reconnu dans ce fichier."));
      // Rattache chaque ligne à la structure candidate la plus proche (≤ 2 coordonnées de jeu).
      const sites = engine.structures.filter((st) => snapKinds.has(st.kind));
      const attached = parsed.sanctuaries.map((q) => {
        const near = sites.find((st) => Math.hypot(st.x - q.x, st.y - q.y) <= 12);
        return near ? { ...q, x: near.x, y: near.y } : q;
      });
      const merged = mergeSanctuaries(sanctuaries, attached, uid);
      setSanctuaries(merged.list);
      say(t("{a} ajouté(s), {u} mis à jour", { a: merged.added, u: merged.updated }) + (parsed.skipped.length ? t(", {n} ligne(s) ignorée(s)", { n: parsed.skipped.length }) : "") + ".");
    } catch (e) {
      say((e as Error).message);
    }
  };
  const importExcel = async () => {
    const file = await openBinaryFile(xlsxFilter());
    if (!file) return;
    try {
      const { parseWorkbook } = await import("../core/excelPlan");
      const alliances = parseWorkbook(file.data);
      setImp({ file: file.name, alliances, chosen: alliances.map(() => true), force: false });
    } catch (e) {
      say((e as Error).message);
    }
  };
  const runImport = async () => {
    if (!imp) return;
    const picked = imp.alliances.filter((_, i) => imp.chosen[i]);
    if (!picked.length) return;
    const { mergeImported } = await import("../core/importPlan");
    const report = mergeImported(plan, picked, engine, imp.force, uid);
    if (report.placed + report.forced > 0) commit(report.plan);
    setImp({ ...imp, report });
  };
  const exportDims = (o: { scale: number; cols: number; rows: number }) => {
    const [w, h] = loaded.imagePixels;
    const k = Math.min(1, 8192 / Math.max(w, h)) * o.scale;
    const W = Math.round(w * k), H = Math.round(h * k);
    return { W, H, tw: Math.round(W / o.cols), th: Math.round(H / o.rows) };
  };
  const exportPng = () => setExp({ format: "webp-lossless", quality: 0.92, scale: 1, cols: 1, rows: 1, busy: false, maxMb: 0 });
  const runExport = async () => {
    const r = renderer.current;
    if (!r || !exp) return;
    const { W, H } = exportDims(exp);
    setExp({ ...exp, busy: true });
    // Mode économe : l'image de fond est réduite en mémoire ; on la recharge en pleine résolution le temps de l'export.
    const full = loaded.loadFullDetail ? await loaded.loadFullDetail().catch(() => null) : null;
    const reduced = scene.assets.detail;
    if (full) scene.assets.detail = full;
    try {
      const imgs = await r.exportImages(W, H, { ...exp, maxBytes: Math.floor(exp.maxMb * 1024 * 1024) });
      const lossy = imgs.find((i) => i.quality !== undefined);
      let ok: boolean;
      if (imgs.length === 1) {
        ok = await saveFile(`${map.map}.${imgs[0].ext}`, imgs[0].blob, [{ name: t("Image"), extensions: [imgs[0].ext] }]);
      } else {
        const files = imgs.map((im, n) => ({ name: `${map.map}_L${Math.floor(n / exp.cols) + 1}_C${(n % exp.cols) + 1}.${im.ext}`, blob: im.blob }));
        ok = await saveMany(files);
      }
      if (ok) say((imgs.length === 1 ? t("Image enregistrée.") : t("{n} images enregistrées.", { n: imgs.length })) + (lossy ? " " + t("Qualité réduite à {q} % pour respecter la limite.", { q: Math.round(Math.min(...imgs.filter((i) => i.quality !== undefined).map((i) => i.quality!)) * 100) }) : ""));
    } catch (e) {
      say((e as Error).message);
    } finally {
      if (full) {
        scene.assets.detail = reduced;
        full.close();
      }
    }
    setExp(null);
  };

  // ---- Calque : capture d'écran redressée ----
  const clearOverlay = useCallback(() => {
    scene.assets.overlay = null;
    setWarped(null);
    setTrace(null);
    setCalibMsg("");
  }, [scene]);
  const loadShot = async () => {
    const file = await openBinaryFile([{ name: t("Image"), extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (!file) return;
    try {
      const blob = new Blob([file.data as BlobPart]);
      const bitmap = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      if (shot) URL.revokeObjectURL(shot.url);
      setShot({ url: URL.createObjectURL(blob), name: file.name, raster: { width: img.width, height: img.height, data: img.data } });
      setPairs([]);
      setPick(null);
      clearOverlay();
      setPanel("points");
    } catch {
      say(t("Image illisible."));
    }
  };
  const onShotPoint = (p: Point) => {
    if (!shot) return;
    if (panel === "points") {
      setPairs((ps) => {
        const pending = ps.findIndex((q) => !q.world);
        return pending >= 0 ? ps.map((q, i) => (i === pending ? { img: p } : q)) : [...ps, { img: p }];
      });
    } else if (panel === "pipette") {
      const x = Math.min(shot.raster.width - 1, Math.floor(p[0]));
      const y = Math.min(shot.raster.height - 1, Math.floor(p[1]));
      const o = (y * shot.raster.width + x) * 4;
      setPick({ at: p, rgb: [shot.raster.data[o], shot.raster.data[o + 1], shot.raster.data[o + 2]] });
    }
  };
  const applyCalibration = async () => {
    if (!shot) return;
    const [{ reprojectionError, solveHomography }, { warpToWorld }] = await Promise.all([import("../core/homography"), import("../core/overlay")]);
    const done = pairs.filter((p): p is ShotPair & { world: Point } => !!p.world);
    if (done.length < 4) return say(t("Il faut au moins 4 repères complets."));
    const h = solveHomography(done.map((p) => p.img), done.map((p) => p.world));
    if (!h) return setCalibMsg(t("Calage impossible : repères alignés ou confondus. Répartissez-les sur toute la capture."));
    const rms = reprojectionError(h, done.map((p) => p.img), done.map((p) => p.world));
    const size = catalog.nativeMapSize;
    const result = warpToWorld(shot.raster, h, [0, 0, size, size]);
    if (!result) return setCalibMsg(t("Calage impossible : la capture contient l'horizon ou un repère est mal placé."));
    const surface = document.createElement("canvas");
    surface.width = result.raster.width;
    surface.height = result.raster.height;
    surface.getContext("2d")!.putImageData(new ImageData(result.raster.data as Uint8ClampedArray<ArrayBuffer>, result.raster.width, result.raster.height), 0, 0);
    scene.assets.overlay = { surface, bounds: result.bounds };
    setWarped(result);
    setTrace(null);
    const cells = rms / TERRITORY_UNIT;
    setCalibMsg(t("Erreur moyenne de calage : {c} coordonnée(s) de jeu ({k} case).", { c: (rms / 6).toFixed(1), k: cells.toFixed(2) }) + (cells > 0.5 ? " " + t("Imprécis : ajoutez des repères ou corrigez-en un.") : ""));
    const [w, so, e, n] = result.bounds;
    renderer.current?.locate((w + e) / 2, (so + n) / 2, 2.5);
  };
  const runDetect = async () => {
    if (!warped || !pick) return;
    const { detectBorderCells } = await import("../core/trace");
    const cells = detectBorderCells(warped, pick.rgb, tol, cov);
    setTrace(cells);
    say(t("{n} case(s) de contour détectée(s).", { n: cells.size }));
  };
  const suggest = async () => {
    if (!warped || !pick || !active) return;
    const [{ detectBorderCells, fillRegion, suggestFlags }, { mergeImported }] = await Promise.all([import("../core/trace"), import("../core/importPlan")]);
    const border = trace ?? detectBorderCells(warped, pick.rgb, tol, cov);
    setTrace(border);
    const { owned } = fillRegion(border, null);
    const room = Math.max(0, (catalog.buildings.flag?.limit ?? 50) - (counts.get("flag") ?? 0));
    const flags = suggestFlags(owned, room).map((f) => ({ kind: "flag" as const, x: f.column * TERRITORY_UNIT + TERRITORY_UNIT / 2, y: f.row * TERRITORY_UNIT + TERRITORY_UNIT / 2 }));
    if (!flags.length) return say(t("Aucun drapeau déduit : affinez la couleur ou la tolérance."));
    const report = mergeImported(plan, [{ name: active.name, buildings: flags }], engine, false, uid);
    if (report.placed > 0) commit(report.plan);
    setImp({ file: "la capture", alliances: [], chosen: [], force: false, report });
  };

  // ---- Calibration de l'image ----
  const [bounds, setBounds] = useState(catalog.bounds.map(String));
  const applyBounds = async (value: number[] | null) => {
    if (!window.rok) return say(t("Calibration : disponible dans l'appli installée."));
    await saveMapOverrides(map.map, { bounds: (value ?? undefined) as [number, number, number, number] | undefined });
    say(t("Enregistré : rouvrez la carte pour appliquer."));
  };

  const buildLabel = (k: BuildingKind) => `${KIND_LABELS[k]} ${counts.get(k) ?? 0}/${catalog.buildings[k]?.limit ?? 0}`;
  const production = summary?.production;

  return (
    <div className="editor">
      <div className="top">
        <button className="burger" onClick={() => setDrawer(!drawer)} aria-label={t("Menu")}>☰</button>
        <button onClick={onBack}>{t("← Cartes")}</button>
        <span className="title">{map.name}{planName ? ` · ${planName}` : ""}</span>
        <button onClick={undo} disabled={!history.current.canUndo} title={t("Ctrl+Z")}>{t("Annuler")}</button>
        <button onClick={redo} disabled={!history.current.canRedo} title={t("Ctrl+Y")}>{t("Rétablir")}</button>
        <button className="primary" onClick={savePlan}>{t("Enregistrer")}</button>
        <button onClick={askName}>{t("Enregistrer sous…")}</button>
        <button onClick={onLibrary}>{t("Mes plans")}</button>
        <button onClick={importExcel}>{t("Importer Excel")}</button>
        <button onClick={exportExcel}>{t("Exporter Excel")}</button>
        <button onClick={exportPng}>{t("Image…")}</button>
        <button onClick={resetPlan}>{t("Nouveau")}</button>
        {editorMode && <button className="primary" onClick={() => { setEditorMode(false); setTool("select"); }} title={t("Revenir au planificateur")}>{t("Quitter l'éditeur de carte")}</button>}
        <span className="sp" />
        <LangSwitch />
        <span className="muted">{t("Zoom ×")}{zoom.toFixed(1)}</span>
        <button onClick={() => renderer.current?.fit()}>{t("Recentrer")}</button>
      </div>

      <aside className={`side ${drawer ? "open" : ""}`}>
        {!editorMode && (<>
        <AlliancesPanel
          alliances={plan.alliances} activeId={active?.id} palette={PALETTE} limit={LIMITS.alliances}
          onActive={setActiveId} onRename={renameAlliance} onRecolor={recolorAlliance} onRemove={removeAlliance} onAdd={addAlliance}
        />

        <BuildPanel
          activeName={active?.name} tool={tool} onTool={setTool}
          kinds={BUILD_KINDS.filter((k) => catalog.buildings[k]).map((k) => ({ kind: k, label: buildLabel(k), full: (counts.get(k) ?? 0) >= (catalog.buildings[k]?.limit ?? 0) }))}
        />

        <AnnotatePanel
          tool={tool} onTool={setTool} tools={ANNOTATION_TOOLS} palette={PALETTE} colorNames={COLOR_NAMES} color={color} onColor={setColor}
          width={width} onWidth={setWidth} selectedCount={selected.size} onSelectAll={selectAll} onDelete={deleteSelected}
        />

        </>)}

        <DisplayPanel
          visibility={visibility}
          onVisibility={setVisibility}
          eco={eco}
          onEco={(on) => { setEcoState(on); setEco(on); say(t(on ? "Mode économe activé : rouvrez la carte pour l'appliquer." : "Mode économe désactivé : rouvrez la carte pour l'appliquer.")); }}
        />


        {editorMode && (
          <PassPanel
            tool={tool} onTool={setTool} levels={passLevels} level={passLevel} onLevel={setPassLevel}
            structureKinds={structureKinds} passKinds={passKinds} onToggleKind={togglePassKind} onClear={() => setPassLevels({})}
          />
        )}

        {(editorMode || sanctOwned.length > 0) && (
          <SanctuaryPanel
            editorMode={editorMode} tool={tool} onTool={setTool} bonus={bonus} onBonus={setBonus}
            sanctuaries={sanctuaries} groups={editorMode ? sanctAll : sanctOwned}
            structureKinds={structureKinds} snapKinds={snapKinds} onToggleKind={toggleSnapKind}
            activeName={active?.name} onLocate={(x, y) => renderer.current?.locate(x, y)}
            canUndo={!!sanctHistory.current.length} onUndo={undoSanctuaries}
            onImport={importSanctuaries} onExport={exportSanctuaries} onClear={() => setSanctuaries([])}
          />
        )}

        {!editorMode && summary && production && (
          <SummaryPanel
            activeName={active?.name} flags={counts.get("flag") ?? 0} flagLimit={catalog.buildings.flag?.limit ?? 50}
            production={production} costs={summary.costs as never} entries={summary.entries}
            onPick={(b) => { renderer.current?.locate(b.x, b.y); setSelected(new Set([b.id])); }}
          />
        )}

        <OverlayPanel
          hasShot={!!shot} shotName={shot?.name} panelOpen={panel !== "off"} warped={!!warped} opacity={opacity} onOpacity={setOpacity}
          onLoad={loadShot} onToggle={() => setPanel(panel === "off" ? (warped ? "pipette" : "points") : "off")}
        />

        <CalibrationPanel defaults={catalog.bounds} desktop={isDesktop()} bounds={bounds} onBounds={setBounds} onApply={applyBounds} />
        {loaded.warnings.map((w) => <p className="muted" key={w}>⚠ {w}</p>)}
      </aside>

      <div className="stage" ref={stage}>
        {shot && panel !== "off" && (
<Suspense fallback={null}>          <ShotPanel
            url={shot.url}
            size={[shot.raster.width, shot.raster.height]}
            mode={panel}
            pairs={pairs}
            picked={pick?.at}
            onPoint={onShotPoint}
            onClose={() => setPanel("off")}
            title={panel === "points" ? t("Calage : repères") : t("Détection des contours")}
            hint={
              panel === "points"
                ? t("1) Cliquez un repère sur la capture (pied d'une forteresse ou d'une structure de la carte). 2) Cliquez le même repère sur la carte, à droite (il s'aimante sur la structure). Minimum 4 repères, éloignés les uns des autres.")
                : t("Cliquez sur un contour de la couleur de l'alliance à retrouver, puis lancez la détection.")
            }
          >
            {panel === "points" ? (
              <>
                <div className="pairs">
                  {pairs.map((p, i) => (
                    <button key={i} className={p.world ? "on" : ""} title={t("Supprimer ce repère")} onClick={() => setPairs((ps) => ps.filter((_, j) => j !== i))}>
                      {i + 1}{p.world ? " ✓" : " …"} ✕
                    </button>
                  ))}
                </div>
                <div className="row" style={{ margin: "6px 0" }}>
                  <button className="primary" onClick={applyCalibration} disabled={pairs.filter((p) => p.world).length < 4}>{t("Appliquer le calage")}</button>
                  {warped && <button onClick={() => setPanel("pipette")}>{t("Détecter des contours →")}</button>}
                </div>
                {calibMsg && <p className="muted">{calibMsg}</p>}
              </>
            ) : (
              <>
                <p>
                  {t("Couleur choisie :")} {pick ? <span className="swatch-lg" style={{ background: `rgb(${pick.rgb.join(",")})` }} /> : t("aucune")}
                </p>
                <label className="slider">{t("Tolérance")} {tol}<input type="range" min={10} max={120} value={tol} onChange={(e) => setTol(Number(e.target.value))} /></label>
                <label className="slider">{t("Couverture")} {Math.round(cov * 100)} %<input type="range" min={0.1} max={0.9} step={0.05} value={cov} onChange={(e) => setCov(Number(e.target.value))} /></label>
                <div className="row" style={{ margin: "6px 0" }}>
                  <button onClick={runDetect} disabled={!pick || !warped}>{t("Détecter les contours")}</button>
                  <button className="primary" onClick={suggest} disabled={!pick || !warped}>{t("Proposer des drapeaux (")}{active?.name})</button>
                  <button onClick={() => setTrace(null)} disabled={!trace}>{t("Effacer le surlignage")}</button>
                  <button onClick={() => setPanel("points")}>{t("← Calage")}</button>
                </div>
                {!warped && <p className="err">{t("Calez d'abord la capture.")}</p>}
              </>
            )}
          </ShotPanel></Suspense>
        )}
        <div className="mapbox" onClick={() => drawer && setDrawer(false)}>
        <canvas
          ref={canvas}
          style={{ cursor: tool === "select" ? "grab" : "crosshair", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { if (!drag.current) { renderer.current?.update({ placement: null }); setHud(""); } }}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="hud" ref={hud} />
        {toast && <div className="toast">{toast}</div>}
        </div>
      </div>

      {textAt && (
        <TextDialog
          value={textValue}
          onChange={setTextValue}
          onClose={() => setTextAt(null)}
          onSubmit={() => {
            const text = textValue.trim();
            if (text && textAt) {
              if (plan.annotations.filter((a) => a.kind === "text").length >= LIMITS.texts) say(t("Limite de textes atteinte."));
              else commit({ ...plan, annotations: [...plan.annotations, { id: uid(), kind: "text", points: [textAt], color, width, text: text.slice(0, 500) }] });
            }
            setTextAt(null);
          }}
        />
      )}
      {nameDialog && <NameDialog value={nameValue} onChange={setNameValue} onClose={() => setNameDialog(false)} onSubmit={() => void writeToLibrary(nameValue)} />}
      {exp && <ExportDialog exp={exp} onChange={setExp} dims={exportDims} onRun={runExport} onClose={() => setExp(null)} />}
      {imp && <ImportDialog imp={imp} onChange={setImp} onRun={runImport} onClose={() => setImp(null)} />}
    </div>
  );
}
