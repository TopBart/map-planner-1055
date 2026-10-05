// Serveur d'accès Map Planner 1055 : valide les clés, délivre des jetons, protège /data, héberge la version web (PWA).
// Usage : node server/server.mjs   (variables : PORT, DATA_DIR, WEB_DIR, KEYS_FILE, TOKEN_DAYS, MP_SECRET, ALLOW_ORIGIN, TRUST_PROXY)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyStore, loadSecret, signToken, verifyToken } from "./lib.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(root, "data"));
const WEB_DIR = resolve(process.env.WEB_DIR ?? join(root, "dist"));
const KEYS_FILE = resolve(process.env.KEYS_FILE ?? join(root, "server", "keys.json"));
const TOKEN_MS = Number(process.env.TOKEN_DAYS ?? 30) * 86400_000;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*";
const secret = loadSecret(join(root, "server", "secret.txt"));
const store = new KeyStore(KEYS_FILE);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".bin": "application/octet-stream", ".woff2": "font/woff2",
};

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 12;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "access-control-allow-origin": ALLOW_ORIGIN,
    "access-control-allow-headers": "authorization, content-type",
    ...headers,
  });
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 8192) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** Jeton présenté (en-tête ou ?t=) → enregistrement de clé valable, ou raison du refus. */
function authorize(req, url) {
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const p = verifyToken(secret, header ?? url.searchParams.get("t"));
  if (!p) return { error: "invalid" };
  const rec = store.findById(p.kid);
  const why = KeyStore.refusal(rec);
  if (why) return { error: why };
  if (!rec.devices.includes(p.dev)) return { error: "device" };
  return { rec, payload: p };
}

const issue = (rec, dev) => {
  const exp = Date.now() + TOKEN_MS;
  return { token: signToken(secret, { kid: rec.id, dev, exp }), exp, label: rec.label ?? "" };
};

function serveFile(req, res, base, rel, { fallback, cache }) {
  let file = resolve(base, "." + sep + normalize("/" + rel));
  if (file !== base && !file.startsWith(base + sep)) return send(res, 403, "forbidden");
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (!fallback) return send(res, 404, "not found");
    file = join(base, "index.html");
    if (!existsSync(file)) return send(res, 404, "web build missing (npm run build:web)");
  }
  const st = statSync(file);
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304); return res.end(); }
  res.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": st.size,
    "cache-control": cache,
    etag,
    "access-control-allow-origin": ALLOW_ORIGIN,
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const ip = (process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
    if (req.method === "OPTIONS") return send(res, 204, "");

    if (url.pathname === "/api/activate" && req.method === "POST") {
      if (limited(ip)) return send(res, 429, { error: "rate" });
      const body = await readJson(req);
      const dev = String(body.deviceId ?? "").slice(0, 64);
      if (!dev) return send(res, 400, { error: "device" });
      const rec = store.findByKey(body.key);
      const why = KeyStore.refusal(rec);
      if (why) return send(res, 403, { error: why });
      if (!rec.devices.includes(dev)) {
        if (rec.devices.length >= (rec.maxDevices ?? 2)) return send(res, 403, { error: "devices" });
        const db = store.read();
        db.keys.find((k) => k.id === rec.id).devices.push(dev);
        store.write(db);
        rec.devices.push(dev);
      }
      return send(res, 200, issue(rec, dev));
    }

    if (url.pathname === "/api/verify" && req.method === "POST") {
      const auth = authorize(req, url);
      if (auth.error) return send(res, auth.error === "invalid" ? 401 : 403, { error: auth.error });
      return send(res, 200, issue(auth.rec, auth.payload.dev));
    }

    if (url.pathname.startsWith("/data/")) {
      const auth = authorize(req, url);
      if (auth.error) return send(res, 401, { error: auth.error });
      return serveFile(req, res, DATA_DIR, decodeURIComponent(url.pathname.slice(6)), { cache: "private, max-age=86400" });
    }

    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
    const rel = decodeURIComponent(url.pathname);
    const isShell = rel === "/" || rel === "/sw.js" || rel.endsWith(".webmanifest") || rel.endsWith(".html");
    return serveFile(req, res, WEB_DIR, rel, { fallback: true, cache: isShell ? "no-cache" : "public, max-age=31536000, immutable" });
  } catch {
    send(res, 400, { error: "bad request" });
  }
}).listen(PORT, () => console.log(`Map Planner 1055 · serveur d'accès sur http://localhost:${PORT} (données : ${DATA_DIR})`));
