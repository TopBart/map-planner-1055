import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const TYPES: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".bin": "application/octet-stream" };

/** En développement (navigateur), sert le dossier data/ sous /data/ comme le fait le protocole rok://. */
function serveData(): Plugin {
  const root = resolve("data");
  return {
    name: "serve-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const file = resolve(join(root, decodeURIComponent((req.url ?? "").split("?")[0])));
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** Injecte un identifiant de build dans le service worker : chaque version publiée est détectée par les navigateurs. */
function stampServiceWorker(): Plugin {
  return {
    name: "stamp-sw",
    apply: "build",
    closeBundle() {
      const file = resolve("dist", "sw.js");
      if (existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").replaceAll("__BUILD__", String(Date.now())));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), serveData(), stampServiceWorker()],
  build: { outDir: "dist", target: "chrome120", sourcemap: false },
  test: { include: ["test/**/*.test.ts"] },
});
