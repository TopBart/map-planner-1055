/**
 * Test de bout en bout dans un vrai navigateur : clé d'accès, langue, éditeur, tiroir mobile, révocation.
 * Lancé seulement avec E2E=1 (npm run e2e) ; nécessite Chromium (variable CHROMIUM_PATH si ce n'est pas celui de Playwright).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeDataDir } from "./fixture";

const run = process.env.E2E === "1";
const dir = mkdtempSync(join(tmpdir(), "mp-e2e-"));
const PORT = "8793";
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, KEYS_FILE: join(dir, "keys.json"), MP_SECRET: "e2e", PORT, DATA_DIR: join(dir, "data"), WEB_DIR: join(dir, "web") };
let server: ChildProcess;
let key = "";
let id = "";

beforeAll(async () => {
  if (!run) return;
  writeDataDir(join(dir, "data"));
  execFileSync("npx", ["vite", "build", "--outDir", join(dir, "web"), "--emptyOutDir"], { env: { ...process.env, VITE_REQUIRE_KEY: "1" }, stdio: "ignore", shell: process.platform === "win32" });
  key = /MP-[A-Z0-9-]+/.exec(execFileSync("node", ["server/admin.mjs", "add"], { env, encoding: "utf8" }))![0];
  id = /^(\w{8})/m.exec(execFileSync("node", ["server/admin.mjs", "list"], { env, encoding: "utf8" }))![1];
  server = spawn("node", ["server/server.mjs"], { env, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + "/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}, 120_000);
afterAll(() => void server?.kill());

describe.skipIf(!run)("parcours complet", () => {
  it("clé → carte → langue → mobile → révocation", async () => {
    const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
    const browser = await chromium.launch({ executablePath });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "en-GB" })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/");
      await page.waitForSelector(".gate");
      await page.fill(".gate input", "MP-AAAA-BBBB-CCCC-DDDD");
      await page.click(".gate button.primary");
      expect(await page.textContent(".gate .error")).toContain("Unknown key");
      await page.fill(".gate input", key);
      await page.click(".gate button.primary");
      await page.waitForSelector(".picker");
      await page.click(".card");
      await page.waitForSelector(".editor canvas", { timeout: 30_000 });
      await page.waitForTimeout(1000);
      expect(await page.textContent(".top")).toContain("Undo");
      await page.selectOption("select.lang", "fr");
      expect(await page.textContent(".top")).toContain("Annuler");
      await page.selectOption("select.lang", "en");
      await page.click("text=Image…");
      expect(await page.textContent(".modal")).toContain("Export the image");
      await page.click(".modal button:has-text('Cancel')");
      await page.setViewportSize({ width: 412, height: 800 });
      expect(await page.isVisible(".burger")).toBe(true);
      await page.click(".burger");
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.querySelector(".side")!.getBoundingClientRect().x)).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);

      execFileSync("node", ["server/admin.mjs", "revoke", id], { env });
      await page.evaluate(() => { localStorage.removeItem("rok-token"); });
      await page.reload();
      await page.waitForSelector(".gate");
      await page.fill(".gate input", key);
      await page.click(".gate button.primary");
      expect(await page.textContent(".gate .error")).toContain("revoked");
    } finally {
      await browser.close();
    }
  }, 120_000);
});
