import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { acquireDataset } from "../../dist/server/platform/runtime/dataset.js";
import { DEMO_ACCOUNT, DEMO_PASSWORD } from "../demo/seed-demo.mjs";

const [dataset, backupDirectory, receiptPath] = process.argv.slice(2);
assert(dataset && backupDirectory, "用法：指定已有导入数据目录、新备份目录及正式数据的导入回执");
const directory = resolve(dataset);
const backup = resolve(backupDirectory);
const markerFile = join(directory, "DEMO-DATA.json");
const demo = existsSync(markerFile) && JSON.parse(readFileSync(markerFile, "utf8"));
assert(!demo || demo.purpose === "local-demo" && demo.asset_basis === "imported-ledger", "仅处理真实导入台账数据集");
const receipt = receiptPath ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
assert(demo || Array.isArray(receipt?.maps?.spans), "正式数据须提供原始导入回执");
const sources = receipt && new Map(receipt.maps.spans.map(row => [row.id, row]));
const account = demo ? DEMO_ACCOUNT : process.env.SD_MAINTENANCE_ACCOUNT;
const password = demo ? DEMO_PASSWORD : process.env.SD_ADMIN_PASSWORD;
assert(account && password, "正式数据须以已有管理员账号授权执行");
process.umask(0o077);
const release = await acquireDataset(directory);
let system;
try {
  system = createSystem(directory);
  const towers = new Map(system.equipment.list("towers", true).map(tower => [tower.id, tower]));
  const spans = system.equipment.list("spans");
  const candidates = [];
  let outOfScope = 0;
  for (const span of spans) {
    const start = towers.get(span.start_tower_id);
    const end = towers.get(span.end_tower_id);
    if (start?.line_id !== span.line_id || end?.line_id !== span.line_id ||
        !Number.isSafeInteger(start.sort_rank) || !Number.isSafeInteger(end.sort_rank) ||
        start.sort_rank === end.sort_rank) {
      outOfScope++;
      continue;
    }
    if (start.sort_rank < end.sort_rank) continue;
    const original = sources?.get(span.id);
    if (span.version !== 1 || start.version !== 1 || end.version !== 1 ||
        start.deleted || end.deleted ||
        sources && (original?.start_id !== start.id || original?.end_id !== end.id)) {
      outOfScope++;
      continue;
    }
    candidates.push(span);
  }

  if (candidates.length) {
    await system.database.backupTo(backup);
    if (demo) copyFileSync(markerFile, join(backup, "DEMO-DATA.json"));
    system.database.transaction(() => {
      const { user, token } = system.auth.login(account, password);
      for (const span of candidates) {
        const next = system.equipment.save(user, "spans", {
          expected_version: span.version,
          start_tower_id: span.end_tower_id,
          end_tower_id: span.start_tower_id,
          reason: "按原始导入的同线路杆塔顺序更正档距方向",
        }, span.id);
        assert(next.version === span.version + 1 && next.status === span.status &&
          next.line_id === span.line_id && next.transmission_center_length_mm === span.transmission_center_length_mm);
      }
      system.auth.logout(token);
      assert(system.database.verifyIntegrity(), "数据完整性检查失败，已回滚");
    });
  }
  console.log("SPAN_DIRECTION_REPAIR_OK", JSON.stringify({ checked: spans.length, corrected: candidates.length, outOfScope }));
} finally {
  system?.close();
  release();
}
