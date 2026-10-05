import { t } from "./i18n";
import { MAX_XLSX_BYTES, MAX_XLSX_COLS, MAX_XLSX_ROWS, MAX_XLSX_UNPACKED } from "./limits";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/** Lecteur/écrivain xlsx minimal (une grille de textes et de nombres) : suffisant pour échanger des plans avec le site. */

export type Cell = string | number | null | { v: string | number; bold?: boolean };
export type Sheet = { name: string; rows: Cell[][]; widths?: number[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
const columnIndex = (letters: string): number => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (cell === null || cell === undefined) return "";
          const { v, bold } = typeof cell === "object" ? cell : { v: cell, bold: false };
          const ref = `${columnName(c)}${r + 1}`;
          const style = bold ? ' s="1"' : "";
          return typeof v === "number"
            ? `<c r="${ref}"${style}><v>${v}</v></c>`
            : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files);
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join("")
  );
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const id = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (id) {
    for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (rel[0].match(/\bId="([^"]+)"/)?.[1] !== id) continue;
      const target = rel[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (target) {
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        if (files[path]) return path;
      }
    }
  }
  const fallback = Object.keys(files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()[0];
  if (!fallback) throw new Error(t("Ce fichier ne contient aucune feuille Excel lisible."));
  return fallback;
}

/** Contenu de la première feuille : tableau de lignes, cellules texte/nombre en chaîne (null si vide). */
export function readXlsx(bytes: Uint8Array): (string | null)[][] {
  let files: Record<string, Uint8Array>;
  if (bytes.byteLength > MAX_XLSX_BYTES) throw new Error(t("Fichier trop volumineux ({mb} Mo maximum).", { mb: MAX_XLSX_BYTES / 1048576 }));
  try {
    let unpacked = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
        unpacked += f.originalSize;
        if (unpacked > MAX_XLSX_UNPACKED) throw new Error("bomb");
        return true;
      },
    });
  } catch {
    throw new Error(t("Fichier illisible : ce n'est pas un classeur .xlsx."));
  }
  const strings = sharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : undefined);
  const xml = strFromU8(files[firstSheetPath(files)]);
  const grid: (string | null)[][] = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!ref || m[2] === undefined) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const body = m[2];
    let value: string | null = null;
    if (type === "inlineStr") value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join("");
    else {
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (raw !== undefined) value = type === "s" ? (strings[Number(raw)] ?? null) : unesc(raw);
    }
    if (value === null || value === "") continue;
    const row = Number(ref[2]) - 1;
    const col = columnIndex(ref[1]);
    if (row < 0 || row >= MAX_XLSX_ROWS || col >= MAX_XLSX_COLS) continue; // évite les tableaux creux gigantesques
    (grid[row] ??= [])[col] = value;
  }
  return Array.from(grid, (r) => (r ? Array.from(r, (v) => v ?? null) : []));
}
