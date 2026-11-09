import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSystem } from "../../server/application/system.mjs";
import { upgradeSchema113 } from "../../server/database/upgrade-equipment-fields.mjs";
import { restoreBackup } from "../../server/database/restore.mjs";

const PRE_GUARD_STRUCTURE = "8e71a39712302e90d5d6248ffda7f7816a8aaf5cf146b42fb78d9b799ceec5e5";
const OLD_TRIGGER = `CREATE TRIGGER object_type_guard_insert BEFORE INSERT ON operation_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM v_work_object_current o WHERE o.id=NEW.work_object_id
 AND o.status='active'
 AND o.work_target_type IN ('both',NEW.work_target_type))
 THEN RAISE(ABORT,'标准作业对象不适用于当前操作类型') END;
END`;
function inventory(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name").all();
}
function fingerprint(db) {
  return createHash("sha256").update(JSON.stringify(inventory(db))).digest("hex");
}
test("controlled Schema113 migration preserves all records and enables work-object-before-operation deletion", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sd-master-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "data");
  const database = join(directory, "schema113.sqlite");
  let s = createSystem(directory);
  s.auth.initialize("admin", "test-password");
  const { user } = s.auth.login("admin", "test-password");
  const unit = s.catalog.save(user, "units", { name: "套" });
  const object = s.catalog.save(user, "objects", {
    name: "防鸟设施", work_target_type: "physical",
  });
  const operation = s.catalog.save(user, "operations", {
    name: "安装防鸟设施", default_unit_id: unit.id,
    work_object_id: object.id,
  });
  s.catalog.remove(user, "objects", object.id, 1);
  const beforeRows = s.repo.list("operation_versions").length;
  s.close();

  const old = new DatabaseSync(database);
  old.exec("DROP TRIGGER object_type_guard_insert;\n" + OLD_TRIGGER + ";");
  assert.equal(fingerprint(old), PRE_GUARD_STRUCTURE, "fixture must exactly match prior deployed schema");
  old.close();

  assert.throws(() => createSystem(directory), /Schema113结构与当前权威SQL不一致/);
  const backupDirectory = join(root, "backup");
  const migrated = await upgradeSchema113(directory, backupDirectory);
  assert.equal(migrated.status, "completed");
  assert.equal(migrated.previous_structure_sha256, PRE_GUARD_STRUCTURE);
  assert.equal(migrated.cleaned_json_fields, 0);
  assert.ok(existsSync(join(backupDirectory, "UPGRADE-RECEIPT.json")));
  const oldBackup = new DatabaseSync(join(backupDirectory, "schema113.sqlite"), { readOnly: true });
  assert.equal(fingerprint(oldBackup), PRE_GUARD_STRUCTURE);
  oldBackup.close();
  assert.ok(existsSync(restoreBackup(backupDirectory, join(root, "restored-original"))));
  s = createSystem(directory);
  assert.equal(s.repo.list("operation_versions").length, beforeRows);
  assert.equal(s.catalog.get("objects", object.id, true).status, "inactive");
  s.catalog.remove(user, "operations", operation.id, 1);
  assert.equal(s.catalog.get("operations", operation.id, true).status, "inactive");
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
  s.close();
  const repeated = await upgradeSchema113(directory, join(root, "unused-upgrade"));
  assert.equal(repeated.status, "already_current", "maintenance is idempotent");
  assert.ok(!existsSync(join(root, "unused-upgrade")));
});

test("controlled guard upgrade rejects unknown schema before touching files or creating backup", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sd-guard-drift-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "data");
  const s = createSystem(directory);
  s.close();
  const drift = new DatabaseSync(join(directory, "schema113.sqlite"));
  drift.exec("CREATE TABLE unexpectedly_added (id TEXT PRIMARY KEY) STRICT");
  drift.close();
  await assert.rejects(upgradeSchema113(directory, join(root, "should-not-be-created")),
    /数据库不匹配本次已批准的升级基线/);
  assert.equal(existsSync(join(root, "should-not-be-created")), false);
});
