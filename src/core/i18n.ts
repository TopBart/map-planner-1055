/**
 * Traduction FR/EN. Le français sert de clé : t("Texte français", { variable }) renvoie le texte dans la langue
 * choisie ({variable} est remplacé). Une clé sans traduction anglaise reste en français (un test les recense).
 */
import { EN } from "./en";

export type Lang = "fr" | "en";
const STORAGE_KEY = "rok-lang";

let current: Lang = "fr";
const listeners = new Set<() => void>();

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    /* stockage indisponible */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "fr";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* sans conséquence */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export const subscribeLang = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function t(fr: string, vars?: Record<string, string | number>): string {
  // « Texte¦contexte » : le contexte départage deux sens (Annuler = Undo ou Cancel) et n'est jamais affiché.
  let text = current === "en" ? (EN[fr] ?? fr) : fr;
  text = text.split("¦")[0];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/** Locale pour les dates et nombres. */
export const locale = () => (current === "en" ? "en-GB" : "fr-FR");
