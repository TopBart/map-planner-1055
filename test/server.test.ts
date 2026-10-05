import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mp-"));
const env = { ...process.env, KEYS_FILE: join(dir, "keys.json"), MP_SECRET: "test-secret", PORT: "8791", DATA_DIR: join(dir, "data"), WEB_DIR: join(dir, "web") };
const admin = (...args: string[]) => execFileSync("node", ["server/admin.mjs", ...args], { env, encoding: "utf8" });
const base = "http://127.0.0.1:8791";
const post = (path: string, body: unknown, token?: string) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
let proc: ChildProcess;
let key = "";
let id = "";

beforeAll(async () => {
  mkdirSync(join(dir, "data", "maps"), { recursive: true });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(join(dir, "data", "maps.json"), '{"ok":true}');
  writeFileSync(join(dir, "web", "index.html"), "<html>app</html>");
  key = /MP-[A-Z0-9-]+/.exec(admin("add", "--label", "test", "--devices", "1"))![0];
  id = /^(\w{8})/m.exec(admin("list"))![1];
  proc = spawn("node", ["server/server.mjs"], { env, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + "/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
afterAll(() => void proc.kill());

describe("serveur de clés", () => {
  it("refuse une clé inconnue, accepte la bonne, limite les appareils", async () => {
    expect((await post("/api/activate", { key: "MP-AAAA-BBBB-CCCC-DDDD", deviceId: "d1" })).status).toBe(403);
    const ok = await post("/api/activate", { key: key.toLowerCase(), deviceId: "d1" });
    expect(ok.status).toBe(200);
    expect((await post("/api/activate", { key, deviceId: "d2" })).status).toBe(403); // 1 appareil max
    expect((await post("/api/activate", { key, deviceId: "d1" })).status).toBe(200); // même appareil
  });

  it("protège /data et la révocation est immédiate", async () => {
    const { token } = (await (await post("/api/activate", { key, deviceId: "d1" })).json()) as { token: string };
    expect((await fetch(base + "/data/maps.json")).status).toBe(401);
    expect((await fetch(base + "/data/maps.json", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(base + `/data/maps.json?t=${encodeURIComponent(token)}`)).status).toBe(200);
    expect((await fetch(base + `/data/..%2Fkeys.json?t=${encodeURIComponent(token)}`)).status).not.toBe(200);
    expect((await post("/api/verify", {}, token)).status).toBe(200);
    admin("revoke", id);
    expect((await fetch(base + "/data/maps.json", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await post("/api/verify", {}, token)).status).toBe(403);
    expect((await post("/api/activate", { key, deviceId: "d1" })).status).toBe(403);
    admin("restore", id);
    expect((await post("/api/verify", {}, token)).status).toBe(200);
  });

  it("sert la version web", async () => {
    expect(await (await fetch(base + "/")).text()).toContain("app");
    expect(await (await fetch(base + "/n-importe-quoi")).text()).toContain("app");
  });
});
