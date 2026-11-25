import { buildCompactServer, compactArtifactHashes } from "./compact-server.mjs";
import { existsSync, mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export async function verifyCompactServer(root, stage, manifest, receipt) {
  assert.equal(existsSync(join(stage,"node_modules")),false,"精简包不得包含散装 node_modules");
  assert.equal(manifest.server_bundle.format,"esbuild-esm-split-v1");
  assert.deepEqual(manifest.server_bundle,receipt.server_bundle);
  assert.ok(manifest.server_bundle.dependencies>0);
  assert.ok(existsSync(join(stage,"dist/server/THIRD-PARTY-NOTICES.txt")));
  assert.equal(createHash("sha256").update(readFileSync(join(stage,"runtime/LICENSE.txt"))).digest("hex"),manifest.runtime_license_sha256);
  assert.deepEqual(compactArtifactHashes(join(stage,"dist/server")),manifest.server_artifact_sha256);
  const count = folder => readdirSync(folder,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?count(join(folder,e.name)):1),0);
  const files=count(stage);
  assert.equal(files,receipt.file_count);
  assert.ok(files<=400,"精简包文件数量门禁：最多400个");
  const temp=mkdtempSync(join(tmpdir(),"sd-reproducible-"));
  try{
    assert.deepEqual(await buildCompactServer(root,temp),manifest.server_bundle);
    assert.deepEqual(compactArtifactHashes(temp),manifest.server_artifact_sha256,"发布后端必须可独立重建");
  }finally{rmSync(temp,{recursive:true,force:true})}
  console.log("COMPACT_PACKAGE_VERIFIED",files,"files, no node_modules, reproducible, notices included");
}

export async function verifyWorkbookRoundtrip(base,headers) {
  const format="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const response=await fetch(base+"/api/exchange/assets/export?asset_kind=physical",{headers});
  assert.equal(response.status,200,await response.clone().text());
  assert.match(response.headers.get("content-type")||"",/spreadsheetml/);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0,2).toString(),"PK","导出必须为有效 XLSX 文件");
  const preview=await fetch(base+"/api/exchange/assets/preview?mode=update",{
    method:"POST",headers:{...headers,"Content-Type":format},body:bytes,
  });
  assert.equal(preview.status,200,await preview.clone().text());
  const result=await preview.json();
  assert.ok(typeof result.token==="string"&&result.token.length>0,"导入预检必须生成批次令牌");
  console.log("COMPACT_XLSX_ROUNDTRIP_OK",bytes.length,"bytes");
}
