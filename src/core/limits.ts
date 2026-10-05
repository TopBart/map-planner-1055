/** Tailles maximales acceptées pour les fichiers ouverts par l'utilisateur (protège contre un fichier démesuré). */
export const MAX_TEXT_BYTES = 20 * 1024 * 1024; // plans .json
export const MAX_XLSX_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_XLSX_UNPACKED = 80 * 1024 * 1024; // protège contre une archive « bombe »
export const MAX_XLSX_ROWS = 20000;
export const MAX_XLSX_COLS = 200;
export const MAX_OVERRIDES_BYTES = 2 * 1024 * 1024;
