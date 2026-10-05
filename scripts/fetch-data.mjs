// Usage : npm run fetch-data [-- --images] [-- slug1 slug2]
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { fetchAll } = require("../electron/fetcher.cjs");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dir = process.env.ROK_DATA_DIR ?? join(root, "data");
let last = "";
const result = await fetchAll(
  dir,
  ({ done, total, label }) => {
    const line = `[${done}/${total}] ${label}`;
    if (line !== last) console.log(line);
    last = line;
  },
  { images: args.includes("--images"), only: args.filter((a) => !a.startsWith("--")) }
);
console.log(`Terminé : ${result.maps} cartes, ${result.files} fichiers dans ${dir}.`);
if (result.errors.length) {
  console.error(result.errors.join("\n"));
  process.exitCode = 1;
}
