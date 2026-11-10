import ts from "typescript";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { pathToFileURL } from "node:url";

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|mjs|vue)$/.test(entry.name) ? [path] : [];
  });
}
export function inspectArchitecture(root) {
  const files = [...sourceFiles(resolve(root, "server")), ...sourceFiles(resolve(root, "web/src"))];
  const inventory = new Set(files), graph = new Map(), issues = [];
  for (const file of files) {
    const name = relative(root, file), raw = readFileSync(file, "utf8");
    const code = file.endsWith(".vue") ? raw.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1] || "" : raw;
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    if (name.startsWith("server/") && file.endsWith(".ts")) {
      function check(node) {
        if (node.kind === ts.SyntaxKind.AnyKeyword) issues.push(name + " contains explicit any");
        ts.forEachChild(node, check);
      }
      check(source);
      if (/@ts-(?:ignore|nocheck)/.test(code)) issues.push(name + " suppresses type checking");
      if (!name.startsWith("server/database/") && /\brepo\.(?:insert|update|remove|query|run)\s*\(/.test(code))
        issues.push(name + " bypasses a typed business repository");
    }
    const edges = [];
    for (const entry of ts.preProcessFile(code).importedFiles) {
      if (!entry.fileName.startsWith(".")) continue;
      const base = resolve(dirname(file), entry.fileName);
      if (/\.css$/.test(base) && existsSync(base)) continue;
      const target = [base, base.replace(/\.js$/, ".ts"), base + ".ts", base + ".vue", base + ".mjs"].find(path => inventory.has(path));
      if (!target) { issues.push(name + " has unresolved import " + entry.fileName); continue; }
      edges.push(target);
      if (name.startsWith("web/src/shared/") && relative(root, target).startsWith("web/src/modules/"))
        issues.push(name + " reverses shared UI dependency into a business module");
      if (/server\/modules\/pricing\/(?:calculation|features|model)\.ts$/.test(name) &&
          /server\/(?:database|platform)\//.test(relative(root, target)))
        issues.push(name + " introduces infrastructure into pricing domain");
    }
    graph.set(file, edges);
  }
  const visiting = new Set(), visited = new Set();
  function walk(file, stack) {
    if (visiting.has(file)) { issues.push("dependency cycle " + [...stack, file].map(path => relative(root, path)).join(" -> ")); return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) || []) walk(next, [...stack, file]);
    visiting.delete(file); visited.add(file);
  }
  for (const file of files) walk(file, []);
  return issues;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const issues = inspectArchitecture(resolve(import.meta.dirname, ".."));
  if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
  else console.log("ARCHITECTURE_OK resolved imports, acyclic dependencies, shared UI boundary and strict server TypeScript");
}
