import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function sourceSnapshot(root) {
  const inputs = [
    "server", "web", "scripts", "docs/architecture", "docs/implementation", "docs/decisions",
    "docs/vendor", ".github", "AGENTS.md", "Makefile", "tests", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "README.md", "tsconfig.server.json",
  ];
  const paths = [];
  function visit(path) {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort())
        if (!["node_modules", "dist", ".DS_Store", ".git", ".vite", "test-results", "coverage"].includes(entry))
          visit(join(path, entry));
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
export function requireNode24() {
  if (!/^v24\./.test(process.version)) throw Error("构建与发布验收须使用 Node24，当前为 " + process.version);
}
