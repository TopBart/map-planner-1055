/**
 * Clé d'accès vérifiée par le serveur (server/server.mjs).
 * - Désactivée par défaut (développement, tests) ; activée à la compilation avec VITE_REQUIRE_KEY=1.
 * - Appli Windows : URL du serveur fixée à la compilation (VITE_SERVER_URL) ou saisie une fois.
 * - Version web / PWA : le serveur est l'origine de la page, et /data n'est servi qu'avec un jeton valide.
 * Hors ligne, le jeton reste valable jusqu'à son expiration (30 jours par défaut, renouvelé à chaque contrôle réussi).
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

const K_TOKEN = "rok-token";
const K_DEVICE = "rok-device";
const K_SERVER = "rok-server";
const RECHECK_MS = 6 * 3600_000;

export type AccessError = "unknown" | "revoked" | "expired" | "devices" | "rate" | "network" | "invalid" | "device" | "server";
export type Stored = { token: string; exp: number; checked: number };

const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

export const accessRequired = (): boolean => env.VITE_REQUIRE_KEY === "1";
const isDesktopApp = () => typeof window !== "undefined" && !!window.rok;

/** Serveur d'accès : mémorisé, sinon compilé, sinon l'origine de la page (version web). */
export function serverUrl(): string {
  const saved = get(K_SERVER) || env.VITE_SERVER_URL || "";
  if (saved) return saved.replace(/\/+$/, "");
  return isDesktopApp() || location.protocol === "file:" || location.protocol === "rok:" ? "" : location.origin;
}
export const needsServerUrl = () => accessRequired() && !serverUrl();
export const setServerUrl = (url: string) => set(K_SERVER, url.trim().replace(/\/+$/, "") || null);

export function deviceId(): string {
  let id = get(K_DEVICE);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, "");
    set(K_DEVICE, id);
  }
  return id;
}

function stored(): Stored | null {
  try { return JSON.parse(get(K_TOKEN) ?? "null"); } catch { return null; }
}
export const token = (): string | null => {
  const s = stored();
  return s && s.exp > Date.now() ? s.token : null;
};

const listeners = new Set<() => void>();
export const onLocked = (cb: () => void) => { listeners.add(cb); return () => void listeners.delete(cb); };
/** Vide le cache hors ligne des données (version web) : après révocation, rien ne doit rester lisible. */
export function purgeDataCache(): void {
  try {
    if (typeof caches === "undefined") return;
    void caches.keys().then((keys) => keys.filter((k) => k === "mp-data" || k.startsWith("mp-shell-")).forEach((k) => void caches.delete(k)));
  } catch {
    /* cache indisponible */
  }
}

export function lock(): void {
  set(K_TOKEN, null);
  purgeDataCache();
  listeners.forEach((l) => l());
}

/** Suffixe ?t=jeton ajouté aux URL de données de la version web (une <img> ne peut pas envoyer d'en-tête). */
export const dataQuery = (): string => (accessRequired() && !isDesktopApp() && token() ? `?t=${encodeURIComponent(token()!)}` : "");

async function call(path: string, body: unknown, tok?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(serverUrl() + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw "network" as AccessError;
  }
  let json: Record<string, unknown> = {};
  try { json = await response.json(); } catch { /* corps vide */ }
  return { status: response.status, json };
}

function save(json: Record<string, unknown>): void {
  set(K_TOKEN, JSON.stringify({ token: json.token as string, exp: json.exp as number, checked: Date.now() } satisfies Stored));
}

/** Active cette installation avec une clé. Lève un code d'erreur (AccessError). */
export async function activate(key: string): Promise<void> {
  const { status, json } = await call("/api/activate", { key, deviceId: deviceId() });
  if (status === 200 && typeof json.token === "string") return save(json);
  throw ((json.error as AccessError) ?? "server") as AccessError;
}

/**
 * Vérifie le jeton enregistré. "ok" : accès valable (contrôle serveur, ou hors ligne dans la période de grâce) ;
 * "locked" : pas de jeton, ou refusé par le serveur (clé révoquée, expirée…).
 */
export async function checkAccess(force = false): Promise<"ok" | "locked"> {
  if (!accessRequired()) return "ok";
  const s = stored();
  if (!s || s.exp <= Date.now()) return "locked";
  if (!force && Date.now() - s.checked < RECHECK_MS) return "ok";
  try {
    const { status, json } = await call("/api/verify", {}, s.token);
    if (status === 200 && typeof json.token === "string") { save(json); return "ok"; }
    if (status === 401 || status === 403) { lock(); return "locked"; }
    return "ok"; // erreur serveur temporaire : on ne bloque pas
  } catch {
    return "ok"; // hors ligne : période de grâce jusqu'à l'expiration du jeton
  }
}

/** Contrôle périodique (retour au premier plan) : verrouille l'appli si la clé a été révoquée. */
export function watchAccess(): () => void {
  if (!accessRequired()) return () => undefined;
  const run = () => void checkAccess();
  const onVisible = () => document.visibilityState === "visible" && run();
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(run, RECHECK_MS);
  return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); };
}
