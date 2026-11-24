import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { requireNode24, sourceSnapshot } from "./release/source-snapshot.mjs";

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
