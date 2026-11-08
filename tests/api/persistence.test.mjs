import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { createSystem } from "../../server/application/system.mjs";
import { createEvidence } from "../../server/application/evidence.mjs";
import { restoreBackup } from "../../server/database/restore.mjs";
test("database and evidence restart, independent backup and verified restore", async (t) => {
  const { s, user, dir, demandInput } = fixture(t),
    demand = s.demands.save(user, demandInput),
    evidence = createEvidence(s),
    bytes = Buffer.from("真实测试附件字节");
  writeFileSync(join(dir, "business.sqlite"), "old-schema112-file-preserved");
  const attachment = evidence.upload(user, {
    owner_kind: "demand_id",
    owner_id: demand.id,
    filename: "依据.txt",
    base64: bytes.toString("base64"),
  });
  const root = mkdtempSync(join(tmpdir(), "sd113-backup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backup = await s.database.backupTo(join(root, "backup"));
  await assert.rejects(() => s.database.backupTo(backup), /已存在/);
  const restored = restoreBackup(backup, join(root, "restored"));
  assert.throws(() => restoreBackup(backup, restored), /独立目录/);
  const reopened = createSystem(restored);
  try {
    assert.equal(reopened.demands.get(demand.id).quantity_scaled, 90000);
    assert.deepEqual(
      createEvidence(reopened).download(user, attachment.id).bytes,
      bytes,
    );
    assert.equal(reopened.repo.integrity().foreignKeys.length, 0);
  } finally {
    reopened.close();
  }
  assert.equal(
    readFileSync(join(dir, "business.sqlite"), "utf8"),
    "old-schema112-file-preserved",
  );
  const second = createSystem(dir);
  try {
    assert.equal(second.demands.get(demand.id).current_version, 1);
  } finally {
    second.close();
  }
});
