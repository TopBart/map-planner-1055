import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "../src/core/en";
import { setLang, t } from "../src/core/i18n";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/(en|i18n)\.ts$/.test(f) ? [p] : [];
  });
}

describe("i18n", () => {
  it("chaque texte t(\"…\") possède une traduction anglaise", () => {
    const missing: string[] = [];
    for (const file of sources("src")) {
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!(key in EN)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("les variables {x} sont conservées dans la traduction", () => {
    for (const [fr, en] of Object.entries(EN)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(vars(en), fr).toBe(vars(fr));
    }
  });

  it("bascule de langue et interpolation", () => {
    setLang("en");
    expect(t("Annuler")).toBe("Undo");
    expect(t("Porte niveau {n}", { n: 3 })).toBe("Gate level 3");
    setLang("fr");
    expect(t("Annuler")).toBe("Annuler");
  });
});
