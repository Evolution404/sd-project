import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { sourceSnapshot } from "./source-snapshot.mjs";

const root = resolve(import.meta.dirname, "../..");
const dist = process.env.SD_RELEASE_OUTPUT_DIR || join(root, "dist");
async function verifiedPackage(name, mode, basename) {
  const manifest = JSON.parse(await readFile(join(dist,name),"utf8"));
  if (manifest.package_mode !== mode || manifest.path !== "dist/"+basename ||
      !manifest.host_verification?.actual_zip_extracted) {
    throw new Error("请先验收当前安装包 "+basename);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(dist,basename))) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha256) throw new Error("安装包与验收清单不一致 "+basename);
  return {manifest,basename};
}

const [formal,demo] = await Promise.all([
  verifiedPackage("RELEASE-MANIFEST.json","production","sd-project-win10-x64.zip"),
  verifiedPackage("DEMO-RELEASE-MANIFEST.json","demo","sd-project-win10-x64-demo.zip"),
]);
const current = formal.manifest;
for (const field of ["git_commit","build_input_sha256","worktree_dirty","schema_version","runtime"]) {
  if (current[field] !== demo.manifest[field]) throw new Error("正式包与演示包的构建基线不一致 "+field);
}
const status = entry => entry.windows_machine_verified ? "已验证" : "暂缓实机验收";
const report = [
  "# 输电项目管理系统交付报告",
  "",
  `代码提交 \`${current.git_commit}\`。构建时工作区${current.worktree_dirty ? "有未提交改动" : "干净"}。`,
  `Schema ${current.schema_version}，Node ${current.runtime}。构建输入 SHA-256 为 \`${current.build_input_sha256}\`。`,
  "",
  "| 安装包 | ZIP SHA-256 | 宿主验证时间 | Windows 实机 |",
  "| --- | --- | --- | --- |",
  ...[formal,demo].map(({manifest,basename}) =>
    `| ${basename} | ${manifest.sha256} | ${manifest.host_verification.verified_at} (${manifest.host_verification.os}) | ${status(manifest)} |`),
  "",
  "正式包与演示包均由各自的发布清单记录宿主机验收。内网生产台账以单独的数据目录交付。",
  "",
  "首次初始化：22种常用单位、8个指定电压等级及5个内置角色。程序更新不自动覆盖已有字典。",
  "正式包一键升级宿主验收："+(current.host_verification.offline_upgrade_restart?"通过（独立安装、备份恢复、账号、业务及附件验证）":"未验收")+"。Windows脚本仍需实机验收。",
  "",
];
// Ordinary manual packaging still supports uncommitted input. A final-gate invocation
// is stricter: both verified archives must match one clean current commit and the
// complete immediately preceding pipeline. Never infer success from old receipts.
if(process.env.SD_FINAL_GATE_LOG){
  const git = (...args)=>{
    const result=spawnSync("git",args,{cwd:root,encoding:"utf8"});
    if(result.status!==0)throw Error(result.stderr||"无法核实 Git 状态");
    return result.stdout.trim();
  };
  if(git("rev-parse","HEAD")!==current.git_commit||git("status","--porcelain")||current.worktree_dirty)
    throw Error("最终门禁要求当前干净 HEAD 与两包构建提交一致");
  if(sourceSnapshot(root).sha256!==current.build_input_sha256)throw Error("最终构建输入摘要与源码不一致");
  const log=await readFile(resolve(root,process.env.SD_FINAL_GATE_LOG),"utf8");
  const counts=[...log.matchAll(/^ℹ tests (\d+)\s*\nℹ suites \d+\s*\nℹ pass (\d+)\s*\nℹ fail (\d+)/gm)].map(m=>({total:+m[1],passed:+m[2],failed:+m[3]}));
  const suites=[...log.matchAll(/^BROWSER_SUITE_TOTAL (.+)$/gm)].map(m=>JSON.parse(m[1]));
  if(counts.length<2||counts.slice(0,2).some(c=>c.total!==c.passed||c.failed!==0)||
    suites.length!==2||suites.some(c=>c.total!==c.passed||c.failed.length)||
    !log.includes("SCHEMA113_FULL_STRUCTURE_AUDIT_OK")||!log.includes("P10_PRODUCTION_REGISTRY_OK")||
    !log.includes("YOULAI_P10_GUIDES_OK")||!log.includes("YOULAI_P10_TRAINING_OK"))
      throw Error("最终门禁日志不完整或有失败项");
  report.push("## 同一提交的发布门禁","",
    "| 门禁 | 实测结果 |","| --- | --- |",
    "| 工程及业务测试 | "+counts[0].passed+"/"+counts[0].total+" |",
    "| Schema 结构审计 | "+log.split("\n").find(line=>line.startsWith("SCHEMA113_FULL_STRUCTURE_AUDIT_OK"))+" |",
    "| 性能测试 | "+counts[1].passed+"/"+counts[1].total+" |",
    "| 正式浏览器 | "+suites[0].passed+"/"+suites[0].total+" |",
    "| 隔离旧版浏览器 | "+suites[1].passed+"/"+suites[1].total+" |",
    "| 正式、演示 ZIP | 实际解压与宿主验收、SHA256复核通过 |",
    "| Git 与构建输入 | 同一当前干净HEAD，输入摘要一致 |","",
    "P10："+log.split("\n").find(line=>line.startsWith("P10_PRODUCTION_REGISTRY_OK")),"",
    "## 审计闭环与已知边界","",
    "逐项证据见 docs/implementation/有来UI最终交付执行矩阵_2026-11-24.md。操作分类见 docs/implementation/P10_正式有来操作覆盖复核_2026-11-24.md。",
    "当前控件声明锚点不等于全部角色、状态的浏览器实测。历史无独立入口的操作不视为已迁移或经批准豁免；Windows物理机验收未执行。","",
    "门禁日志："+process.env.SD_FINAL_GATE_LOG,"");
}
const output = join(dist,"FINAL-DELIVERY-REPORT.md");
const pending = output + ".pending";
await writeFile(pending,report.join("\n"));
await rename(pending,output);
console.log("DELIVERY_REPORT_VERIFIED",current.git_commit);

