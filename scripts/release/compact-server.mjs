/** Package-only, reproducible server bundle. Development and source tests retain tsc modules. */
import { build, version } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Preserve the documented CLI/module paths. Put all entry bundles and shared
// chunks at the same depth as platform/paths.js, so projectRoot is identical.
const entries = {
  main: "main.js",
  bootstrap: "bootstrap.js",
  connection: "database/connection.js",
  restore: "database/restore.js",
  "managed-shutdown": "platform/runtime/managed-shutdown.js",
  exchange: "modules/exchange/service.js",
  workbook: "modules/exchange/workbook.js",
  auth: "platform/auth/service.js",
  http: "platform/http/server.js",
};
const portable = path => path.replaceAll("\\", "/");

function packageNotices(root, inputs) {
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    if (!portable(input).includes("node_modules/")) continue;
    let dir = dirname(realpathSync(resolve(root, input)));
    while (dir !== dirname(dir)) {
      const json = join(dir, "package.json");
      if (existsSync(json)) {
        const pkg = JSON.parse(readFileSync(json, "utf8"));
        if (pkg.name && pkg.version) {
          packages.set(dir, pkg);
          break;
        }
      }
      dir = dirname(dir);
    }
  }
  assert(packages.size > 0, "未发现第三方依赖，禁止缺少运行时依赖的打包");
  const sections = [];
  for (const [dir, pkg] of packages) {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && /^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i.test(e.name))
      .map(e => e.name).sort();
    // Some packages declare their license and embed the notice in README.
    if (!names.length) {
      const readme = readdirSync(dir).find(name => /^readme(\..*)?$/i.test(name));
      if (readme) names.push(readme);
    }
    assert(names.length, "依赖缺少许可或声明文件：" + pkg.name + "@" + pkg.version);
    const heading = pkg.name + "@" + pkg.version + " — " + JSON.stringify(pkg.license ?? pkg.licenses ?? "see notices");
    const body = names.map(name => name + "\n" + readFileSync(join(dir,name),"utf8").trim()).join("\n\n");
    sections.push(heading + "\n" + body);
  }
  return { count: packages.size, text: [...new Set(sections)].sort().join("\n\n" + "=".repeat(72) + "\n\n") + "\n" };
}

export async function buildCompactServer(root, output) {
  root = resolve(root);
  output = resolve(output);
  const platform = join(output,"platform");
  mkdirSync(platform,{recursive:true});
  const entryPoints = Object.fromEntries(Object.entries(entries).map(([name,path]) =>
    [name + "-bundle", join(root,"dist/server",path)]));
  const result = await build({
    absWorkingDir:root, entryPoints, outdir:platform,
    bundle:true, splitting:true, platform:"node", format:"esm", target:"node24",
    entryNames:"[name]", chunkNames:"chunk-[hash]", metafile:true,
    // CommonJS dependencies use Node built-ins. Do not rely on global require
    // or installed modules on the deployed Windows machine.
    banner:{js:'import { createRequire as __sdRequire } from "node:module"; const require = __sdRequire(import.meta.url);'},
    legalComments:"inline", logLevel:"silent",
  });
  assert.equal(result.warnings.length,0,JSON.stringify(result.warnings));
  for(const [name, details] of Object.entries(result.metafile.outputs)) {
    for(const imported of details.imports) {
      if(imported.external) assert(isBuiltin(imported.path),"未合并的外部依赖："+imported.path+" from "+name);
    }
  }
  for(const [name,path] of Object.entries(entries)){
    const shim=join(output,path);
    mkdirSync(dirname(shim),{recursive:true});
    let target=portable(relative(dirname(shim),join(platform,name+"-bundle.js")));
    if(!target.startsWith("."))target="./"+target;
    writeFileSync(shim, name==="main"?`import ${JSON.stringify(target)};\n`:`export * from ${JSON.stringify(target)};\n`);
  }
  mkdirSync(join(output,"database/schema"),{recursive:true});
  copyFileSync(join(root,"dist/server/database/schema/schema113.sql"),join(output,"database/schema/schema113.sql"));
  const notices=packageNotices(root,result.metafile.inputs);
  writeFileSync(join(output,"THIRD-PARTY-NOTICES.txt"),notices.text);
  return { format:"esbuild-esm-split-v1", bundler_version:version, dependencies:notices.count };
}

export function compactArtifactHashes(directory) {
  const hashes={};
  function visit(folder) {
    for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(folder,entry.name);
      if(entry.isDirectory()) visit(path);
      else hashes[portable(relative(directory,path))]=createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
  visit(directory);
  return hashes;
}
