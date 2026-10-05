/** Mode économe : moins de mémoire et de GPU (utile sur PC modeste, tablette, smartphone). */
const KEY = "rok-eco";

export function isEco(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    /* stockage indisponible : détection automatique */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return touch || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency ?? 8) <= 4;
}

export function setEco(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* sans conséquence */
  }
}

/** Plus grand côté (px) de l'image de fond gardée en mémoire, et du calque des zones interdites. */
export const detailMaxSide = (eco: boolean) => (eco ? 4096 : 16384);
export const layerMaxSide = (eco: boolean) => (eco ? 2048 : 4096);
export const maxDpr = (eco: boolean) => (eco ? 1.25 : 2);
