import { t } from "../core/i18n";
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "../core/limits";
import { dataQuery, lock, token, accessRequired } from "./access";
export type FileFilter = { name: string; extensions: string[] };

export type PlanEntry = { id: string; name: string; map: string; updated: number; buildings: number; alliances: number };

export type RokApi = {
  saveMany(files: { name: string; data: Uint8Array }[]): Promise<string | null>;
  saveFile(name: string, data: string | Uint8Array, filters?: FileFilter[]): Promise<string | null>;
  openFile(filters?: FileFilter[]): Promise<{ name: string; text: string } | null>;
  openBinary(filters?: FileFilter[]): Promise<{ name: string; data: Uint8Array } | null>;
  plansList(): Promise<PlanEntry[]>;
  plansRead(id: string): Promise<unknown>;
  plansWrite(name: string, plan: unknown): Promise<string | null>;
  plansExists(name: string): Promise<boolean>;
  plansDelete(id: string): Promise<boolean>;
  plansOpenFolder(): Promise<void>;
  dataInfo(): Promise<{ dir: string; hasMaps: boolean }>;
  openDataFolder(): Promise<void>;
  fetchData(opts?: { images?: boolean; only?: string[] }): Promise<{ maps: number; files: number; errors: string[] }>;
  onFetchProgress(cb: (p: { done: number; total: number; label: string }) => void): () => void;
  updateInfo(): Promise<{ supported: boolean; version: string }>;
  installUpdate(): Promise<void>;
  onUpdate(cb: (s: { state: "downloading" | "ready"; version: string }) => void): () => void;
  readOverrides(slug: string): Promise<unknown>;
  writeOverrides(slug: string, value: unknown): Promise<boolean>;
};

declare global {
  interface Window {
    rok?: RokApi;
  }
}

export const isDesktop = () => typeof window !== "undefined" && !!window.rok;

/** Les données sont servies sous rok://app/data/ dans l'appli, sous /data/ en développement. */
const DATA_BASE = location.protocol === "rok:" ? "rok://app/data/" : "./data/";
export const dataUrl = (path: string) => DATA_BASE + path.split("/").map(encodeURIComponent).join("/") + dataQuery();

/** fetch d'un fichier de données ; un refus du serveur (clé révoquée) verrouille l'appli. */
export async function dataFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(dataUrl(path), init);
  if (response.status === 401 && accessRequired() && location.protocol.startsWith("http") && token()) lock();
  return response;
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const response = await dataFetch(path);
  if (!response.ok) throw new Error(t("Fichier introuvable : {path} ({status})",{path,status:response.status}));
  return new Uint8Array(await response.arrayBuffer());
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const response = await dataFetch(path, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function saveFile(name: string, data: string | Uint8Array | Blob, filters: FileFilter[]): Promise<boolean> {
  if (window.rok) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    return (await window.rok.saveFile(name, bytes, filters)) !== null;
  }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

export async function saveMany(files: { name: string; blob: Blob }[]): Promise<boolean> {
  if (window.rok) {
    const list = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
    return (await window.rok.saveMany(list)) !== null;
  }
  for (const f of files) await saveFile(f.name, f.blob, []);
  return true;
}

export function openTextFile(filters: FileFilter[]): Promise<{ name: string; text: string } | null> {
  if (window.rok) return window.rok.openFile(filters);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file && file.size > MAX_TEXT_BYTES) return resolve(null);
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function openBinaryFile(filters: FileFilter[]): Promise<{ name: string; data: Uint8Array } | null> {
  if (window.rok) return window.rok.openBinary(filters);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file && file.size > MAX_IMAGE_BYTES) return resolve(null);
      resolve(file ? { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Bibliothèque de plans : fichiers data/plans/*.json dans l'appli, localStorage en navigateur (développement). */
const LS = "rok-library:";
export const library = {
  async list(): Promise<PlanEntry[]> {
    if (window.rok) return window.rok.plansList();
    const out: PlanEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS)) continue;
      try {
        const { plan, updated } = JSON.parse(localStorage.getItem(key) ?? "");
        out.push({ id: key.slice(LS.length), name: key.slice(LS.length), map: plan.map, updated, buildings: plan.buildings.length, alliances: plan.alliances.length });
      } catch {
        /* entrée illisible */
      }
    }
    return out.sort((a, b) => b.updated - a.updated);
  },
  async read(id: string): Promise<unknown> {
    if (window.rok) return window.rok.plansRead(id);
    return JSON.parse(localStorage.getItem(LS + id) ?? "null")?.plan ?? null;
  },
  async exists(name: string): Promise<boolean> {
    if (window.rok) return window.rok.plansExists(name);
    return localStorage.getItem(LS + name.trim()) !== null;
  },
  async write(name: string, plan: unknown): Promise<string | null> {
    if (window.rok) return window.rok.plansWrite(name, plan);
    const id = name.trim().slice(0, 80);
    if (!id) return null;
    localStorage.setItem(LS + id, JSON.stringify({ plan, updated: Date.now() }));
    return id;
  },
  async remove(id: string): Promise<void> {
    if (window.rok) await window.rok.plansDelete(id);
    else localStorage.removeItem(LS + id);
  },
  async openFolder(): Promise<void> {
    await window.rok?.plansOpenFolder();
  },
};
