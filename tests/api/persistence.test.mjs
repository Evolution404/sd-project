import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { createSystem } from "../../dist/server/bootstrap.js";
import { createEvidence } from "../../dist/server/platform/files/service.js";
import { restoreBackup } from "../../dist/server/database/restore.js";
test("database and evidence restart, independent backup and verified restore", async (t) => {
  const { s, user, dir, demandInput } = fixture(t),
    demand = s.demands.save(user, demandInput),
    evidence = createEvidence(s),
    bytes = Buffer.from("真实测试附件字节");
  writeFileSync(join(dir, "unrelated-user-file.txt"), "unrelated-fixture-content");
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
  const snapshotCopy = restoreBackup(restored, join(root, "restored-copy"));
  assert.deepEqual(readFileSync(join(snapshotCopy, "schema113.sqlite")), readFileSync(join(backup, "schema113.sqlite")));
  const reopened = createSystem(restored);
  try {
    assert.equal(reopened.demands.get(demand.id).quantity_scaled, 90000);
    assert.deepEqual(
      createEvidence(reopened).download(user, attachment.id).bytes,
      bytes,
    );
    assert.equal(inspect(reopened).integrity().foreignKeys.length, 0);
  } finally {
    reopened.close();
  }
  assert.equal(
    readFileSync(join(dir, "unrelated-user-file.txt"), "utf8"),
    "unrelated-fixture-content",
  );
  const second = createSystem(dir);
  try {
    assert.equal(second.demands.get(demand.id).current_version, 1);
  } finally {
    second.close();
  }
});

test("restore refuses a damaged attachment without creating the destination", async t => {
  const { s, user, demandInput } = fixture(t);
  const created = s.demands.save(user, demandInput);
  const evidence = createEvidence(s);
  const link = evidence.upload(user, {
    owner_kind: "demand_id", owner_id: created.id,
    filename: "质量依据.txt", base64: Buffer.from("可信附件").toString("base64"),
  });
  const root = mkdtempSync(join(tmpdir(), "sd-atomic-restore-corrupted-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backup = await s.database.backupTo(join(root, "backup"));
  const relative = evidence.download(user, link.id).file.storage_key;
  writeFileSync(join(backup, "objects", relative), "故意损坏的附件");
  const target = join(root, "restored");
  assert.throws(() => restoreBackup(backup, target), /备份附件不完整/);
  assert.equal(existsSync(target), false);
});

test("restore refuses schema drift without mutating the requested destination", async t => {
  const { s } = fixture(t);
  const root = mkdtempSync(join(tmpdir(), "sd-atomic-restore-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backup = await s.database.backupTo(join(root, "backup"));
  const drift = new DatabaseSync(join(backup, "schema113.sqlite"));
  drift.exec("CREATE TABLE unauthorized_fixture(id TEXT PRIMARY KEY) STRICT");
  drift.close();
  const target = join(root, "restored");
  assert.throws(() => restoreBackup(backup, target), /Schema113结构与当前权威SQL不一致/);
  assert.equal(existsSync(target), false);
  assert.equal(readFileSync(join(backup, "schema113.sqlite")).length > 0, true);
});

test("restore refuses a live SQLite directory with a WAL and preserves its pending pages", t => {
  const { s, dir, user, demandInput } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  const root = mkdtempSync(join(tmpdir(), "sd-restore-live-sqlite-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "restored");
  assert.ok(existsSync(join(dir, "schema113.sqlite-wal")));
  assert.throws(() => restoreBackup(dir, target), /SQLite 写入文件/);
  assert.equal(existsSync(target), false);
  assert.equal(s.demands.get(demand.id).current_version, 1);
});
