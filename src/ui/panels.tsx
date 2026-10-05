import type { ReactNode } from "react";
import { toGame } from "../core/coords";
import { t } from "../core/i18n";
import { KIND_FR as KIND_LABELS } from "../core/labels";
import { BONUSES, bonusByKey, formatPercents, type sanctuaryGroups } from "../core/sanctuary";
import type { Building, BuildingKind, Sanctuary, Tool } from "../core/types";
import { STAT_ICON_URL } from "../render/bonusIcons";
import type { Visibility } from "../render/draw";
import { ResourceIcon } from "./ResourceIcon";
import { locale } from "../core/i18n";

/** Panneaux latéraux de l'éditeur (présentation seule : l'état et les actions viennent d'Editor). */

export const VISIBILITY_LABELS: [keyof Visibility, string][] = [
  ["forbidden", "Zones interdites"],
  ["playable", "Bordure hors zone jouable"],
  ["resources", "Ressources"],
  ["resourceZones", "Zones des ressources"],
  ["sanctuaries", "Sanctuaires"],
  ["passLevels", "Niveau des portes"],
  ["allianceTags", "Noms des alliances"],
  ["caves", "Grottes"],
  ["villages", "Villages"],
  ["provinces", "Provinces interdites"],
];

const RSS_ROWS: ["credits" | "food" | "wood" | "stone" | "coin" | "crystal", string, string][] = [
  ["credits", "Crédits", "credits"],
  ["food", "Nourriture", "food"],
  ["wood", "Bois", "wood"],
  ["stone", "Pierre", "stone"],
  ["coin", "Or", "coin"],
  ["crystal", "Cristal", "crystal"],
];
const fmt = (n: number) => Math.round(n).toLocaleString(locale());

export function DisplayPanel(p: {
  visibility: Visibility;
  onVisibility: (v: Visibility) => void;
  eco: boolean;
  onEco: (on: boolean) => void;
}) {
  return (
    <section className="toggles">
      <h3>{t("Affichage")}</h3>
      {VISIBILITY_LABELS.map(([k, label]) => (
        <label key={k}>
          <input type="checkbox" checked={p.visibility[k]} onChange={(e) => p.onVisibility({ ...p.visibility, [k]: e.target.checked })} /> {t(label)}
        </label>
      ))}
      <label className="check" title={t("Moins de mémoire et de GPU : image de fond réduite à 4096 px, rendu 1,25× au plus (l'export reste en pleine résolution)")}>
        <input type="checkbox" checked={p.eco} onChange={(e) => p.onEco(e.target.checked)} /> {t("Mode économe")}
      </label>
    </section>
  );
}

function KindList(p: { kinds: [string, number][]; chosen: Set<string>; onToggle: (k: string) => void }) {
  return (
    <>
      {p.kinds.map(([kind, n]) => (
        <label key={kind} className="check">
          <input type="checkbox" checked={p.chosen.has(kind)} onChange={() => p.onToggle(kind)} /> {kind} ({n})
        </label>
      ))}
    </>
  );
}

export function PassPanel(p: {
  tool: Tool;
  onTool: (t: Tool) => void;
  levels: Record<string, number>;
  level: number;
  onLevel: (n: number) => void;
  structureKinds: [string, number][];
  passKinds: Set<string>;
  onToggleKind: (k: string) => void;
  onClear: () => void;
}) {
  const on = p.tool === "pass-level";
  const count = Object.keys(p.levels).length;
  return (
    <section>
      <h3>{t("Niveau des portes (")}{count})</h3>
      <button className={on ? "on" : ""} onClick={() => p.onTool(on ? "select" : "pass-level")}>
        {on ? t("Saisie en cours (Échap pour finir)") : t("Définir le niveau des portes")}
      </button>
      <div className="levels">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} className={p.level === n ? "on" : ""} onClick={() => { p.onLevel(n); p.onTool("pass-level"); }}>{n}</button>
        ))}
      </div>
      <p className="muted">{t("Choisissez un niveau (touches 1 à 9), puis cliquez près d'une porte. Recliquer avec le même niveau, ou Maj+clic, retire le niveau. Enregistré avec la carte.")}</p>
      <details>
        <summary className="muted">{t("Structures reconnues comme portes")}</summary>
        <KindList kinds={p.structureKinds} chosen={p.passKinds} onToggle={p.onToggleKind} />
      </details>
      <div className="row">
        <button onClick={() => window.confirm(t("Effacer tous les niveaux de portes de cette carte ?")) && p.onClear()} disabled={!count}>{t("Tout effacer")}</button>
      </div>
    </section>
  );
}

type Groups = ReturnType<typeof sanctuaryGroups>;
const BonusIcons = ({ parts }: { parts: { stat: string }[] | undefined }) => (
  <>{parts?.map((q) => <img key={q.stat} className="bicon" src={STAT_ICON_URL[q.stat]} alt="" />)}</>
);

export function SanctuaryPanel(p: {
  editorMode: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
  bonus: string;
  onBonus: (key: string) => void;
  sanctuaries: Sanctuary[];
  groups: Groups;
  structureKinds: [string, number][];
  snapKinds: Set<string>;
  onToggleKind: (k: string) => void;
  activeName?: string;
  onLocate: (x: number, y: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  onImport: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const { editorMode, groups } = p;
  const on = p.tool === "sanctuary";
  return (
    <section>
      {editorMode && <h3>{t("Sanctuaires (")}{p.sanctuaries.length}{t(") · éditeur de carte")}</h3>}
      {editorMode && (
        <>
          <button className={on ? "on" : ""} onClick={() => p.onTool(on ? "select" : "sanctuary")}>
            {on ? t("Saisie en cours (Échap pour finir)") : t("Saisir des sanctuaires")}
          </button>
          <div className="bonuses">
            {BONUSES.map((b) => (
              <button key={b.key} className={p.bonus === b.key ? "on" : ""} style={{ borderLeft: `6px solid ${b.color}` }} onClick={() => { p.onBonus(b.key); p.onTool("sanctuary"); }}>
                <span className="muted">{b.hotkey.toUpperCase()}</span>
                <BonusIcons parts={b.parts} />
                <span>{b.parts.length > 1 ? b.label : `${b.label} +${Math.round(b.value * 1000) / 10} %`}</span>
              </button>
            ))}
          </div>
          <p className="muted">{t("Choisissez un bonus (touches indiquées à gauche), puis cliquez près d'un sanctuaire : la saisie se rattache au sanctuaire le plus proche. Recliquer sur un sanctuaire change son bonus ; Maj+clic le supprime. Enregistré automatiquement avec la carte.")}</p>
          <details>
            <summary className="muted">{t("Structures reconnues comme sanctuaires")}</summary>
            <KindList kinds={p.structureKinds} chosen={p.snapKinds} onToggle={p.onToggleKind} />
            {p.structureKinds.length === 0 && <p className="muted">{t("Aucune structure dans les données de cette carte.")}</p>}
          </details>
        </>
      )}
      {!editorMode && groups.length > 0 && <h3 style={{ marginTop: 4 }}>{t("Dans le territoire de")} {p.activeName}</h3>}
      {groups.length > 0 && (
        <div className="stats">
          {groups.map((g) => (
            <span key={g.def.key} style={{ display: "contents" }}>
              <span className="rss">
                <BonusIcons parts={g.def.parts} />
                {g.def.parts.length > 1 ? g.def.label.replace(/ \(.*\)$/, "") : g.def.label} ×{g.count}
              </span>
              <b>{formatPercents(g.totals)}</b>
            </span>
          ))}
        </div>
      )}
      {editorMode && p.sanctuaries.length > 0 && (
        <div className="blist">
          {p.sanctuaries.map((sc) => (
            <button key={sc.id} onClick={() => p.onLocate(sc.x, sc.y)} title={t("Centrer sur ce sanctuaire")}>
              <span className="rss"><BonusIcons parts={bonusByKey(sc.bonus)?.parts} />{bonusByKey(sc.bonus)?.label ?? sc.bonus}</span>
              <span className="muted">{toGame(sc.x)}, {toGame(sc.y)}</span>
            </button>
          ))}
        </div>
      )}
      {editorMode && (
        <div className="row">
          <button onClick={p.onUndo} disabled={!p.canUndo}>{t("Annuler")}</button>
          <button onClick={p.onImport}>{t("Importer (Excel)")}</button>
          <button onClick={p.onExport} disabled={!p.sanctuaries.length}>{t("Exporter (Excel)")}</button>
          <button onClick={() => window.confirm(t("Supprimer tous les sanctuaires de cette carte ?")) && p.onClear()} disabled={!p.sanctuaries.length}>{t("Tout effacer")}</button>
        </div>
      )}
    </section>
  );
}

type Entry = { building: Building; number: number };
export function SummaryPanel(p: {
  activeName?: string;
  flags: number;
  flagLimit: number;
  production: Record<string, number>;
  costs: Record<string, number> & { unknown: number };
  entries: Entry[];
  onPick: (b: Building) => void;
}) {
  return (
    <section>
      <h3>{t("Synthèse ·")} {p.activeName}</h3>
      <div className="stats">
        <span>{t("Drapeaux")}</span><b>{p.flags} / {p.flagLimit}</b>
        {RSS_ROWS.filter(([k]) => k !== "credits").map(([k, label, prod]) => (
          <span key={k} style={{ display: "contents" }}>
            <span className="rss"><ResourceIcon kind={k} />{t(label)} {t("/ h")}</span>
            <b>{fmt(p.production[prod] ?? 0)}</b>
          </span>
        ))}
      </div>
      <h3 style={{ marginTop: 10 }}>{t("Coût de construction")}</h3>
      <div className="stats">
        {RSS_ROWS.map(([k, label]) => (
          <span key={k} style={{ display: "contents" }}>
            <span className="rss"><ResourceIcon kind={k} />{t(label)}</span>
            <b>{fmt(p.costs[k === "coin" ? "gold" : k])}</b>
          </span>
        ))}
      </div>
      {p.costs.unknown > 0 && <p className="muted">{p.costs.unknown} {t("bâtiment(s) sans coût connu.")}</p>}
      <h3 style={{ marginTop: 10 }}>{t("Bâtiments")}</h3>
      <BuildingList entries={p.entries} onPick={p.onPick} />
    </section>
  );
}

function BuildingList(p: { entries: Entry[]; onPick: (b: Building) => void }): ReactNode {
  return (
    <div className="blist">
      {p.entries.length === 0 && <p className="muted" style={{ padding: 8 }}>{t("Aucun bâtiment.")}</p>}
      {p.entries.map(({ building, number }) => (
        <button key={building.id} onClick={() => p.onPick(building)}>
          <span>{KIND_LABELS[building.kind as BuildingKind]} {number}</span>
          <span className="muted">{toGame(building.x)}, {toGame(building.y)}</span>
        </button>
      ))}
    </div>
  );
}

export function AlliancesPanel(p: {
  alliances: { id: string; name: string; color: string }[];
  activeId?: string;
  palette: readonly string[];
  limit: number;
  onActive: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section>
      <h3>{t("Alliances")}</h3>
      {p.alliances.map((a) => (
        <div className={`alliance ${a.id === p.activeId ? "active" : ""}`} key={a.id}>
          <button className="swatch" style={{ background: a.color }} title={t("Changer de couleur")} onClick={() => p.onRecolor(a.id, p.palette[(p.palette.findIndex((c) => c === a.color.toUpperCase()) + 1) % p.palette.length])} />
          <input type="text" value={a.name} onFocus={() => p.onActive(a.id)} onChange={(e) => p.onRename(a.id, e.target.value)} maxLength={80} />
          <button className={a.id === p.activeId ? "on" : ""} onClick={() => p.onActive(a.id)}>{t("Active")}</button>
          <button onClick={() => p.onRemove(a.id)} disabled={p.alliances.length < 2} title={t("Supprimer l'alliance et ses bâtiments")}>✕</button>
        </div>
      ))}
      <button onClick={p.onAdd} disabled={p.alliances.length >= p.limit}>{t("+ Ajouter une alliance")}</button>
    </section>
  );
}

export function BuildPanel(p: { activeName?: string; tool: Tool; onTool: (t: Tool) => void; kinds: { kind: BuildingKind; label: string; full: boolean }[] }) {
  return (
    <section>
      <h3>{t("Construire (")}{p.activeName})</h3>
      <div className="tools">
        {p.kinds.map((k) => (
          <button key={k.kind} className={p.tool === k.kind ? "on" : ""} disabled={k.full} onClick={() => p.onTool(p.tool === k.kind ? "select" : k.kind)}>{k.label}</button>
        ))}
      </div>
    </section>
  );
}

export function AnnotatePanel(p: {
  tool: Tool;
  onTool: (t: Tool) => void;
  tools: [Tool, string][];
  palette: readonly string[];
  colorNames: readonly string[];
  color: string;
  onColor: (c: string) => void;
  width: number;
  onWidth: (w: number) => void;
  selectedCount: number;
  onSelectAll: () => void;
  onDelete: () => void;
}) {
  return (
    <section>
      <h3>{t("Annoter")}</h3>
      <div className="tools">
        <button className={p.tool === "select" ? "on" : ""} onClick={() => p.onTool("select")}>{t("Sélection")}</button>
        {p.tools.map(([k, label]) => (
          <button key={k} className={p.tool === k ? "on" : ""} onClick={() => p.onTool(p.tool === k ? "select" : k)}>{t(label)}</button>
        ))}
      </div>
      <div className="palette">
        {p.palette.map((c, i) => (
          <button key={c} className={`swatch ${c === p.color ? "sel" : ""}`} style={{ background: c }} title={t(p.colorNames[i])} onClick={() => p.onColor(c)} />
        ))}
      </div>
      <label className="muted">{t("Épaisseur")} {p.width} <input type="range" min={1} max={8} value={p.width} onChange={(e) => p.onWidth(Number(e.target.value))} /></label>
      <div className="row">
        <button onClick={p.onSelectAll}>{t("Tout sélectionner")}</button>
        <button onClick={p.onDelete} disabled={!p.selectedCount}>{t("Supprimer (")}{p.selectedCount})</button>
      </div>
    </section>
  );
}

export function OverlayPanel(p: { shotName?: string; hasShot: boolean; panelOpen: boolean; warped: boolean; opacity: number; onOpacity: (o: number) => void; onLoad: () => void; onToggle: () => void }) {
  return (
    <section>
      <h3>{t("Calque · capture d'écran (expérimental)")}</h3>
      <div className="row" style={{ margin: 0 }}>
        <button onClick={p.onLoad}>{p.hasShot ? t("Autre capture…") : t("Importer une capture…")}</button>
        {p.hasShot && <button onClick={p.onToggle}>{p.panelOpen ? t("Masquer") : t("Rouvrir")}</button>}
      </div>
      {p.warped && (
        <label className="slider">{t("Opacité")} <input type="range" min={0.1} max={1} step={0.05} value={p.opacity} onChange={(e) => p.onOpacity(Number(e.target.value))} /></label>
      )}
      {p.hasShot && <p className="muted">{p.shotName}{p.warped ? t(" · calée") : t(" · à caler")}</p>}
    </section>
  );
}

export function CalibrationPanel(p: { defaults: number[]; desktop: boolean; bounds: string[]; onBounds: (b: string[]) => void; onApply: (v: number[] | null) => void }) {
  const names = [t("Ouest"), t("Sud"), t("Est"), t("Nord")];
  return (
    <details>
      <summary>{t("Calibrer l'image de fond")}</summary>
      <p className="muted">{t("Étendue de votre PNG en unités internes (1 coordonnée de jeu = 6 unités) : ouest, sud, est, nord. Par défaut")} {p.defaults.join(", ")}. {p.desktop ? "" : t("(appli installée uniquement)")}</p>
      <div className="calib">
        {names.map((label, i) => (
          <input key={label} type="text" placeholder={label} title={label} value={p.bounds[i]} onChange={(e) => p.onBounds(p.bounds.map((v, j) => (j === i ? e.target.value : v)))} />
        ))}
      </div>
      <div className="row">
        <button onClick={() => p.onApply(p.bounds.map(Number))} disabled={!p.bounds.every((v) => v.trim() !== "" && Number.isFinite(Number(v)))}>{t("Appliquer")}</button>
        <button onClick={() => p.onApply(null)}>{t("Valeurs d'origine")}</button>
      </div>
    </details>
  );
}
