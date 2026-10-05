// Clés d'accès + jetons signés. Aucune dépendance.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const normalizeKey = (key) => String(key ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashKey = (key) => createHash("sha256").update(normalizeKey(key)).digest("hex");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I
export function generateKey() {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return "MP-" + [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export class KeyStore {
  constructor(file) {
    this.file = file;
    this.cache = null;
    this.mtime = 0;
  }
  read() {
    if (!existsSync(this.file)) return { keys: [] };
    const m = statSync(this.file).mtimeMs;
    if (!this.cache || m !== this.mtime) {
      this.cache = JSON.parse(readFileSync(this.file, "utf8"));
      this.mtime = m;
    }
    return this.cache;
  }
  write(db) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, this.file);
    this.cache = null;
  }
  findByKey(key) {
    const h = hashKey(key);
    return this.read().keys.find((k) => k.hash === h);
  }
  findById(id) {
    return this.read().keys.find((k) => k.id === id);
  }
  /** Raison de refus d'une clé, ou null si elle est valable. */
  static refusal(rec) {
    if (!rec) return "unknown";
    if (rec.revoked) return "revoked";
    if (rec.expires && Date.parse(rec.expires + "T23:59:59Z") < Date.now()) return "expired";
    return null;
  }
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");

export function signToken(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return body + "." + createHmac("sha256", secret).update(body).digest("base64url");
}

export function verifyToken(secret, token) {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return p && typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function loadSecret(file) {
  if (process.env.MP_SECRET) return process.env.MP_SECRET;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString("hex");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}
