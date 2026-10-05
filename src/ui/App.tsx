import { getLang, locale, subscribeLang, t } from "../core/i18n";
import { LangSwitch } from "./LangSwitch";
import { registerPwa } from "./pwa";
import { purgeDataCache, accessRequired, activate, checkAccess, needsServerUrl, onLocked, serverUrl, setServerUrl, watchAccess, type AccessError } from "./access";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { loadMapList } from "../core/dataset";
import { parsePlan } from "../core/plan";
import { SEASONS, type MapSummary, type Plan } from "../core/types";
import { Editor } from "./Editor";
import { type Loaded, loadMap } from "./loader";
import { dataUrl, isDesktop, library, openTextFile, type PlanEntry, readBytes } from "./platform";

export type Start = { plan: Plan; name: string | null };

type Screen =
  | { kind: "boot" }
  | { kind: "setup"; reason?: string }
  | { kind: "picker"; maps: MapSummary[] }
  | { kind: "loading"; map: MapSummary; label: string; fraction: number }
  | { kind: "plans" }
  | { kind: "editor"; map: MapSummary; loaded: Loaded; start?: Start; mapEditor?: boolean }
  | { kind: "error"; message: string };

export function App() {
  useSyncExternalStore(subscribeLang, getLang);
  const [gate, setGate] = useState<"checking" | "ok" | "locked">(accessRequired() ? "checking" : "ok");
  useEffect(() => {
    if (!accessRequired()) return;
    void checkAccess().then(setGate);
    const off = onLocked(() => setGate("locked"));
    const stop = watchAccess();
    return () => { off(); stop(); };
  }, []);
  const [update, setUpdate] = useState<{ text: string; label?: string; apply?: () => void } | null>(null);
  useEffect(() => {
    const off = window.rok?.onUpdate((u) =>
      setUpdate(u.state === "ready"
        ? { text: t("Version {v} prête.", { v: u.version }), label: t("Redémarrer et installer"), apply: () => void window.rok?.installUpdate() }
        : { text: t("Téléchargement de la version {v}…", { v: u.version }) }));
    registerPwa((apply) => setUpdate({ text: t("Nouvelle version disponible."), label: t("Recharger"), apply }));
    return off;
  }, []);
  if (gate === "checking") return <Center>{t("Vérification de l'accès…")}</Center>;
  if (gate === "locked") return <Gate onDone={() => setGate("ok")} />;
  return (
    <>
      <Main />
      {update && (
        <div className="updatebar" role="status">
          <span>{update.text}</span>
          {update.apply && <button className="primary" onClick={update.apply}>{update.label}</button>}
          <button className="ghost" onClick={() => setUpdate(null)} aria-label={t("Fermer")}>✕</button>
        </div>
      )}
    </>
  );
}

const GATE_ERRORS: Record<AccessError, string> = {
  unknown: "Clé inconnue.",
  revoked: "Cette clé a été révoquée.",
  expired: "Cette clé a expiré.",
  devices: "Cette clé est déjà utilisée sur le nombre maximum d'appareils.",
  rate: "Trop d'essais : patientez une minute.",
  network: "Serveur injoignable : vérifiez la connexion et l'adresse du serveur.",
  invalid: "Accès refusé.",
  device: "Appareil non reconnu pour cette clé.",
  server: "Réponse inattendue du serveur.",
};

function Gate({ onDone }: { onDone: () => void }) {
  useEffect(() => purgeDataCache(), []);
  const [key, setKey] = useState("");
  const [server, setServer] = useState(serverUrl());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const askServer = needsServerUrl() || (typeof window !== "undefined" && !!window.rok);
  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (askServer) setServerUrl(server);
      await activate(key);
      onDone();
    } catch (e) {
      setError(t(GATE_ERRORS[e as AccessError] ?? GATE_ERRORS.server));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Center>
      <div className="gate">
        <h1>{t("Map Planner 1055")}</h1>
        <p>{t("Entrez votre clé d'accès pour continuer.")}</p>
        <input autoFocus value={key} placeholder="MP-XXXX-XXXX-XXXX-XXXX" spellCheck={false} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        {askServer && <input value={server} placeholder="https://…" spellCheck={false} onChange={(e) => setServer(e.target.value)} title={t("Adresse du serveur d'accès")} />}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !key.trim() || (askServer && !server.trim())} onClick={() => void submit()}>{busy ? t("Vérification…") : t("Activer")}</button>
          <LangSwitch />
        </div>
      </div>
    </Center>
  );
}

function Main() {
  const [screen, setScreen] = useState<Screen>({ kind: "boot" });
  const [maps, setMaps] = useState<MapSummary[]>([]);

  const boot = useCallback(async () => {
    try {
      const list = await loadMapList(readBytes);
      if (!list.length) throw new Error(t("Aucune carte dans maps.json."));
      setMaps(list);
      setScreen({ kind: "picker", maps: list });
    } catch (e) {
      setScreen({ kind: "setup", reason: (e as Error).message });
    }
  }, []);
  useEffect(() => void boot(), [boot]);

  const open = useCallback(async (map: MapSummary, start?: Start, mapEditor?: boolean) => {
    setScreen({ kind: "loading", map, label: t("Chargement"), fraction: 0 });
    try {
      const loaded = await loadMap(map.map, (label, fraction) => setScreen({ kind: "loading", map, label, fraction }));
      setScreen({ kind: "editor", map, loaded, start, mapEditor });
    } catch (e) {
      setScreen({ kind: "error", message: (e as Error).message });
    }
  }, []);

  switch (screen.kind) {
    case "boot":
      return <Center>{t("Démarrage…")}</Center>;
    case "setup":
      return <Setup reason={screen.reason} onDone={boot} />;
    case "picker":
      return <Picker maps={screen.maps} onOpen={(m, mapEditor) => open(m, undefined, mapEditor)} onSetup={() => setScreen({ kind: "setup" })} onPlans={() => setScreen({ kind: "plans" })} />;
    case "plans":
      return <Plans maps={maps} onBack={() => setScreen({ kind: "picker", maps })} onOpen={open} />;
    case "loading":
      return (
        <Center>
          <div className="loading">
            <h2>{screen.map.name}</h2>
            <div className="bar"><div style={{ width: `${Math.round(screen.fraction * 100)}%` }} /></div>
            <p>{screen.label}…</p>
          </div>
        </Center>
      );
    case "error":
      return (
        <Center>
          <div className="loading">
            <h2>{t("Impossible d'ouvrir la carte")}</h2>
            <p className="err">{screen.message}</p>
            <button onClick={() => setScreen({ kind: "picker", maps })}>{t("Retour aux cartes")}</button>
          </div>
        </Center>
      );
    case "editor":
      return <Editor key={screen.map.map + (screen.start?.name ?? "") + (screen.mapEditor ? "-ed" : "")} startInMapEditor={screen.mapEditor} map={screen.map} loaded={screen.loaded} start={screen.start} onBack={() => setScreen({ kind: "picker", maps })} onLibrary={() => setScreen({ kind: "plans" })} />;
  }
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="center">{children}</div>;

function Picker({ maps, onOpen, onSetup, onPlans }: { maps: MapSummary[]; onOpen: (m: MapSummary, mapEditor: boolean) => void; onSetup: () => void; onPlans: () => void }) {
  const [mapEditor, setMapEditor] = useState(false);
  return (
    <div className="picker">
      <header>
        <h1>{t("Map Planner 1055")}</h1>
        <p>{t("Choisissez une carte pour planifier les territoires, les routes et les coordonnées de votre alliance.")}</p>
        <div className="row">
          <button className="primary" onClick={onPlans}>{t("Mes plans")}</button>
          <button className="ghost" onClick={onSetup}>{t("Données et mises à jour")}</button>
          <LangSwitch />
          <button className={mapEditor ? "primary" : "ghost"} style={mapEditor ? { background: "#e0a21b", borderColor: "#e0a21b", color: "#111" } : undefined} onClick={() => setMapEditor(!mapEditor)} title={t("Saisir les sanctuaires et le niveau des portes d'une carte")}>
            {mapEditor ? t("Éditeur de carte : activé") : t("Éditeur de carte")}
          </button>
        </div>
        {mapEditor && <p className="muted">{t("Mode éditeur de carte : choisissez la carte à compléter (sanctuaires, niveau des portes).")}</p>}
      </header>
      {SEASONS.map(([season, label]) => {
        const group = maps.filter((m) => m.season === season);
        if (!group.length) return null;
        return (
          <section key={season}>
            <h2>{t(label)}</h2>
            <div className="grid">
              {group.map((m) => (
                <button key={m.map} className="card" onClick={() => onOpen(m, mapEditor)}>
                  <img src={dataUrl(`maps/${m.map}/overview.webp`)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Setup({ reason, onDone }: { reason?: string; onDone: () => void }) {
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [result, setResult] = useState<string[]>([]);
  const [dir, setDir] = useState("");

  useEffect(() => {
    void window.rok?.dataInfo().then((i) => setDir(i.dir));
    return window.rok?.onFetchProgress(setProgress);
  }, []);

  const run = async () => {
    if (!window.rok) return;
    setBusy(true);
    setResult([]);
    const r = await window.rok.fetchData({ images });
    setBusy(false);
    if (r.errors.length) setResult(r.errors.slice(0, 8));
    else onDone();
  };

  return (
    <Center>
      <div className="loading setup">
        <h2>{t("Données des cartes")}</h2>
        {reason && <p className="muted">{t("Aucune donnée locale utilisable (")}{reason}).</p>}
        {isDesktop() ? (
          <>
            <p>{t("Téléchargez une fois les règles, zones interdites et icônes des cartes (quelques dizaines de Mo). Ensuite l'appli fonctionne hors ligne.")}</p>
            <label className="check"><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} /> {t("Télécharger aussi les images du site (inutile si vous fournissez vos propres PNG)")}</label>
            <div className="row">
              <button className="primary" disabled={busy} onClick={run}>{busy ? t("Téléchargement…") : t("Télécharger les données")}</button>
              <button onClick={() => window.rok?.openDataFolder()}>{t("Ouvrir le dossier de données")}</button>
              <button className="ghost" onClick={onDone}>{t("Réessayer")}</button>
            </div>
            {progress && busy && (
              <>
                <div className="bar"><div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
                <p className="muted">{progress.done}/{progress.total} · {progress.label}</p>
              </>
            )}
            {result.map((line) => <p className="err" key={line}>{line}</p>)}
            {dir && <p className="muted">{t("Dossier :")} {dir}<br />{t("Vos images :")} <code>maps/&lt;map&gt;/map.png</code></p>}
          </>
        ) : (
          <p>{t("Lancez")} <code>{t("npm run fetch-data")}</code> {t("dans le projet, puis rechargez la page.")}</p>
        )}
      </div>
    </Center>
  );
}

function Plans({ maps, onBack, onOpen }: { maps: MapSummary[]; onBack: () => void; onOpen: (m: MapSummary, start: Start) => void }) {
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [message, setMessage] = useState("");
  const reload = useCallback(() => void library.list().then(setEntries), []);
  useEffect(reload, [reload]);
  const mapName = (slug: string) => maps.find((m) => m.map === slug)?.name ?? slug;

  const openPlan = async (entry: PlanEntry) => {
    try {
      const plan = parsePlan(await library.read(entry.id));
      const map = maps.find((m) => m.map === plan.map);
      if (!map) return setMessage(t("La carte « {map} » n'est pas dans vos données : téléchargez-la dans « Données et mises à jour ».",{map:plan.map}));
      onOpen(map, { plan, name: entry.id });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const importJson = async () => {
    const file = await openTextFile([{ name: "Plan ROK", extensions: ["json"] }]);
    if (!file) return;
    try {
      const plan = parsePlan(JSON.parse(file.text));
      const map = maps.find((m) => m.map === plan.map);
      if (!map) return setMessage(t("La carte « {map} » n'est pas dans vos données.",{map:plan.map}));
      onOpen(map, { plan, name: null });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const remove = async (entry: PlanEntry) => {
    if (!window.confirm(t("Supprimer le plan « {name} » ?",{name:entry.name}))) return;
    await library.remove(entry.id);
    reload();
  };

  return (
    <div className="picker">
      <header>
        <h1>{t("Mes plans")}</h1>
        <p>{t("Vos plans enregistrés")}{isDesktop() ? t(" (fichiers .json dans le dossier data/plans)") : ""}{t(". Ouvrez-en un pour continuer à le modifier.")}</p>
        <div className="row">
          <button onClick={onBack}>{t("← Cartes")}</button>
          <button onClick={importJson}>{t("Ouvrir un fichier .json")}</button>
          {isDesktop() && <button onClick={() => library.openFolder()}>{t("Ouvrir le dossier")}</button>}
        </div>
        {message && <p className="err">{message}</p>}
      </header>
      {entries === null ? (
        <p className="muted">{t("Chargement…")}</p>
      ) : entries.length === 0 ? (
        <p className="muted">{t("Aucun plan enregistré. Dans l'éditeur, utilisez « Enregistrer ».")}</p>
      ) : (
        <div className="plans">
          {entries.map((e) => (
            <div className="plan-row" key={e.id}>
              <div>
                <b>{e.name}</b>
                <div className="muted">{mapName(e.map)} · {e.alliances} {t("alliance(s) ·")} {e.buildings} {t("bâtiment(s) ·")} {new Date(e.updated).toLocaleString(locale())}</div>
              </div>
              <div className="row" style={{ margin: 0 }}>
                <button className="primary" onClick={() => openPlan(e)}>{t("Ouvrir")}</button>
                <button onClick={() => remove(e)}>{t("Supprimer")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
