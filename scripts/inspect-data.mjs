// Affiche la structure des fichiers .bin d'une carte (utile si le format des provinces change).
// Usage : node scripts/inspect-data.mjs <slug> [categorie]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { decodeJsonContainer } = await import(join(root, "src/core/container.ts"));
const [slug, category = "province"] = process.argv.slice(2);
if (!slug) throw new Error("Usage : node scripts/inspect-data.mjs <slug> [categorie]");
const dir = process.env.ROK_DATA_DIR ?? join(root, "data");
const value = decodeJsonContainer(readFileSync(join(dir, "maps", slug, `${category}.bin`)));
const show = (v, depth = 0) =>
  Array.isArray(v) ? `Array(${v.length}) [${v.slice(0, 3).map((x) => show(x, depth + 1)).join(", ")}…]`
  : v && typeof v === "object" ? (depth > 2 ? "{…}" : `{ ${Object.entries(v).map(([k, x]) => `${k}: ${show(x, depth + 1)}`).join(", ")} }`)
  : typeof v === "string" ? JSON.stringify(v.slice(0, 40)) : String(v);
console.log(show(value));
