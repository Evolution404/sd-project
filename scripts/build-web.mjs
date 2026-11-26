import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireNode24, sourceSnapshot } from "./release/source-snapshot.mjs";
import { checkFrontendBudget } from "./release/check-frontend-budget.mjs";

requireNode24();
const root = resolve(import.meta.dirname, "..");
const pnpm = process.env.npm_execpath;
if (!pnpm || !process.env.npm_config_user_agent?.startsWith("pnpm/10.34.5 "))
  throw Error("请使用 pnpm 10.34.5 运行 build:web");
const result = spawnSync(process.execPath, [pnpm, "--dir", "web", "run", "build",
  "--outDir", "../dist/web", "--emptyOutDir"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SD_BUILD_ID: sourceSnapshot(root).sha256,
    VITE_API_BASE: "",
    VITE_BASE_URL: "/",
    VITE_TENANT_ENABLED: "false",
    VITE_OIDC_ENABLED: "false",
    VITE_AI_ENABLED: "false",
  },
});
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) {
  const output = resolve(root, "dist/web");
  const manifestPath = resolve(output, ".vite/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Build checks traverse this manifest as a graph. The offline SPA loads
  // the generated HTML and chunks directly, so only the graph references
  // can be normalized here. Keep the emitted assets and CSS order intact.
  for (const chunk of Object.values(manifest)) {
    for (const key of ["imports", "dynamicImports"]) chunk[key]?.sort();
  }
  const ordered = value => Array.isArray(value) ? value.map(ordered) :
    value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  writeFileSync(manifestPath, JSON.stringify(ordered(manifest), null, 2) + "\n");
  checkFrontendBudget(output);
}
