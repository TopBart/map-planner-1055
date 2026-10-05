// Lance le test de bout en bout (navigateur réel) : npm run e2e
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run", "test/e2e.test.ts"], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, E2E: "1" } });
process.exit(r.status ?? 1);
