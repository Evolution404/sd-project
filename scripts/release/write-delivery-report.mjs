import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dist = join(root, "dist");
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
];
const output = join(dist,"FINAL-DELIVERY-REPORT.md");
const pending = output + ".pending";
await writeFile(pending,report.join("\n"));
await rename(pending,output);
console.log("DELIVERY_REPORT_VERIFIED",current.git_commit);

