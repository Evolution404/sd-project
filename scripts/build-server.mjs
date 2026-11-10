import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/server");
rmSync(output, { recursive: true, force: true });
const result = spawnSync(process.execPath,
  [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.server.json"],
  { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
mkdirSync(resolve(output, "database/schema"), { recursive: true });
cpSync(resolve(root, "server/database/schema/schema113.sql"), resolve(output, "database/schema/schema113.sql"));
console.log("SERVER_BUILD_OK dist/server");
