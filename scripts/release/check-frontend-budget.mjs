import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export function checkFrontendBudget(directory) {
  const root=resolve(directory);
  const manifest=JSON.parse(readFileSync(join(root,".vite/manifest.json"),"utf8"));
  const allFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>
    entry.isDirectory()?allFiles(join(dir,entry.name)):[join(dir,entry.name)]);
  const scripts=allFiles(root).filter(file=>file.endsWith(".js"));
  const size=file=>statSync(file).size;
  const total=scripts.reduce((n,file)=>n+size(file),0);
  const largest=scripts.slice().sort((a,b)=>size(b)-size(a))[0];
  assert.ok(largest,"missing JavaScript assets");
  assert.ok(size(largest)<=1200000,"oversize frontend chunk: "+largest+" "+size(largest));
  assert.ok(total<=15000000,"frontend JavaScript budget exceeded: "+total);
  assert.ok(!scripts.some(file=>/[/\\]exceljs(?:[.-]|$)/i.test(file)),"duplicate browser Excel engine");
  const initial=["index.html","src/views/login/index.vue","src/views/dashboard/index.vue"];
  const closure=keys=>{
    const seen=new Set();
    while(keys.length){
      const key=keys.pop();
      if(seen.has(key))continue;
      assert.ok(manifest[key],"missing asset manifest entry "+key);
      seen.add(key);
      keys.push(...(manifest[key].imports||[]));
    }
    return new Set([...seen].map(key=>manifest[key].file));
  };
  const entry=closure(["index.html"]);
  const ordinary=closure(initial.slice());
  const heavy=/(?:^|[/\\])(?:worksheet-(?:react|core|formula|render|ui|plugins)|univer-engine|settlement-worksheet)/;
  assert.ok(![...ordinary].some(file=>heavy.test(file)),"worksheet engine is eager on login/dashboard");
  assert.ok(scripts.some(file=>/worksheet-formula[.]/.test(file)),"missing worksheet formula runtime");
  const initialBytes=[...entry].filter(file=>file.endsWith(".js")).reduce((n,file)=>n+size(join(root,file)),0);
  assert.ok(initialBytes<=700000,"initial entry JS budget exceeded: "+initialBytes);
  const data={jsFiles:scripts.length,jsBytes:total,jsGzipBytes:scripts.reduce((n,file)=>n+gzipSync(readFileSync(file)).length,0),largestBytes:size(largest),largestFile:largest.slice(root.length+1),initialBytes,ordinaryRouteBytes:[...ordinary].filter(file=>file.endsWith(".js")).reduce((n,file)=>n+size(join(root,file)),0),worksheetEager:false,browserExcel:false};
  console.log("FRONTEND_BUDGET_OK",JSON.stringify(data));
  return data;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  checkFrontendBudget(process.argv[2]||"dist/web");
