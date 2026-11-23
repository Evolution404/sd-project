import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function sourceSnapshot(root) {
  const inputs = ["server", "web", "scripts", "docs/architecture", "docs/implementation", "docs/decisions",
    "package.json", "package-lock.json", "README.md", "vite.config.ts", "tsconfig.json", "tsconfig.server.json"];
  const paths = [];
  function visit(path) {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort())
        if (entry !== "node_modules" && entry !== ".DS_Store") visit(join(path, entry));
    } else paths.push(path);
  }
  for (const input of inputs) visit(join(root, input));
  const hash = createHash("sha256"), files = {};
  for (const path of paths.sort()) {
    const name = relative(root, path).replaceAll("\\", "/");
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    files[name] = digest;
    hash.update(name + "\0" + digest + "\n");
  }
  return { sha256: hash.digest("hex"), files };
}
export function requireNode26() {
  if (!/^v26\./.test(process.version)) throw Error("构建与发布验收须使用Node26，当前为" + process.version);
}
