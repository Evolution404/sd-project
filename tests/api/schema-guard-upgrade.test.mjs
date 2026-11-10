import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSystem } from "../../dist/server/bootstrap.js";
import { upgradeSchema113 } from "../../dist/server/database/upgrade-equipment-fields.mjs";
import { restoreBackup } from "../../dist/server/database/restore.mjs";
import { spawnSync } from "node:child_process";
const PRE_PRICE_STRUCTURE = "c666bc3dbd3392af5bcac585147a9920ed897c0c7ef641ae692815b692d4f044";
function previousPriceDefinitions() {
  // Pin this repository's audited previous release for migration acceptance.
  const oldSql = spawnSync("git", ["show", "ca7d225:server/database/schema/schema113.sql"],
    { encoding: "utf8" });
  assert.equal(oldSql.status, 0);
  const previous = new DatabaseSync(":memory:");
  try {
    previous.exec(oldSql.stdout);
    return Object.fromEntries(["v_reference_price_current", "reference_price_factor_definition_guard"]
      .map(name => [name, previous.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name).sql]));
  } finally { previous.close(); }
}
function restorePreviousPriceDefinitions(db) {
  const definitions = previousPriceDefinitions();
  db.exec("DROP VIEW v_reference_price_current; DROP TRIGGER reference_price_factor_definition_guard;");
  db.exec(definitions.v_reference_price_current + ";");
  db.exec(definitions.reference_price_factor_definition_guard + ";");
}

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
  restorePreviousPriceDefinitions(old);
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


test("explicit price-lifecycle upgrade preserves old rules and permits status-only retirement", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sd-price-lifecycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "data");
  let s = createSystem(directory);
  s.auth.initialize("admin", "test-password");
  const { user } = s.auth.login("admin", "test-password");
  const save = (kind, input) => s.catalog.save(user, kind, input);
  const unit = save("units", { name: "套" });
  const object = save("objects", {
    name: "防鸟装置", work_target_type: "physical",
  });
  const factor = save("factors", {
    name: "现场难度", fields_json: { kind: "enum", values: ["普通", "困难"] },
  });
  const operation = save("operations", {
    name: "安装防鸟", work_object_id: object.id, default_unit_id: unit.id,
    pricing_features_json: [{
      factor_id: factor.id, factor_version: 1, source: "manual", required: false,
    }],
  });
  const rule = save("prices", {
    title: "旧价规则", operation_id: operation.id,
    pricing_mode: "fixed", unit_price_fen: 2000,
    price_source: "工程核价", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "核价证据",
    additional_conditions_json: {
      [factor.code]: { factor_version: 1, op: "eq", value: "普通" },
    },
  });
  s.close();
  const old = new DatabaseSync(join(directory, "schema113.sqlite"));
  restorePreviousPriceDefinitions(old);
  assert.equal(fingerprint(old), PRE_PRICE_STRUCTURE);
  old.close();

  assert.throws(() => createSystem(directory), /结构与当前权威SQL不一致/);
  const backupDir = join(root, "backup");
  const receipt = await upgradeSchema113(directory, backupDir);
  assert.equal(receipt.previous_structure_sha256, PRE_PRICE_STRUCTURE);
  assert.equal(receipt.cleaned_json_fields, 0);
  assert.ok(existsSync(join(backupDir, "UPGRADE-RECEIPT.json")));

  s = createSystem(directory);
  assert.equal(s.catalog.get("prices", rule.id).price_source, "工程核价");
  s.catalog.save(user, "factors", {
    name: "现场难度新版", expected_version: 1,
  }, factor.id);
  const original = s.catalog.get("prices", rule.id);
  assert.throws(() => s.catalog.save(user, "prices", {
    title: "不允许旧版本继续改价", expected_version: 1,
  }, rule.id), /已更新或停用/);
  const checked = s.catalog.previewPrice(user, {
    ...original, existing_id: rule.id, status: "inactive",
  });
  assert.equal(checked.valid, true);
  const inactive = s.catalog.save(user, "prices", {
    status: "inactive", expected_version: 1, reason: "旧价格停止使用",
  }, rule.id);
  assert.equal(inactive.version_no, 2);
  assert.equal(inactive.status, "inactive");
  assert.equal(inactive.operation_version, original.operation_version);
  assert.equal(inactive.additional_conditions_json, original.additional_conditions_json);
  assert.equal(s.catalog.history("prices", rule.id).length, 2);
  assert.equal(s.catalog.list("prices").find(row => row.id === rule.id).status, "inactive");
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
  s.close();
  const repeated = await upgradeSchema113(directory, join(root, "unused"));
  assert.equal(repeated.status, "already_current");
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
