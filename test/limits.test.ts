import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readXlsx } from "../src/core/xlsx";

const sheet = (cells: string) => `<worksheet><sheetData>${cells}</sheetData></worksheet>`;
const book = (sheetXml: string) =>
  zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheetXml), "xl/workbook.xml": strToU8("<workbook/>") });

describe("limites de taille", () => {
  it("ignore les cellules à des lignes/colonnes démesurées (pas de tableau creux géant)", () => {
    const xml = sheet('<c r="A1" t="inlineStr"><is><t>ok</t></is></c><c r="A99999999" t="inlineStr"><is><t>x</t></is></c><c r="ZZZ2" t="inlineStr"><is><t>y</t></is></c>');
    const t0 = performance.now();
    const grid = readXlsx(book(xml));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(grid).toEqual([["ok"]]);
  });
  it("refuse un classeur trop gros", () => {
    expect(() => readXlsx(new Uint8Array(21 * 1024 * 1024))).toThrow();
  });
  it("refuse une archive qui se décompresse démesurément", () => {
    const big = "<worksheet>" + "a".repeat(90 * 1024 * 1024) + "</worksheet>";
    expect(() => readXlsx(book(big))).toThrow();
  });
});
