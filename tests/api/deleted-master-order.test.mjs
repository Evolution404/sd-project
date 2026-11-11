import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("remove linked work object first, then operation and price without losing immutable history", (t) => {
  const { s, user, object, operation, price } = fixture(t);
  const operationBefore = s.catalog.get("operations", operation.id);
  const priceBefore = s.catalog.get("prices", price.id);
  const oldWorkObjectId = operationBefore.work_object_id;
  const oldPriceOperationVersion = priceBefore.operation_version;
  const oldPriceUnitVersion = priceBefore.unit_version;

  const objectDeleted = s.catalog.remove(user, "objects", object.id, 1);
  assert.equal(objectDeleted.deleted, true);
  assert.equal(s.catalog.list("objects").some(row => row.id === object.id), false);
  assert.equal(s.catalog.get("objects", object.id, true).status, "inactive");
  assert.throws(() => s.catalog.save(user, "operations", {
    name: "尝试在失效关联上继续启用", expected_version: operationBefore.version,
  }, operation.id), /作业对象已停用/);
  assert.throws(() => s.catalog.save(user, "operations", {
    name: "不允许新建绑定失效对象", work_object_id: object.id,
    default_unit_id: operationBefore.default_unit_id,
  }), /作业对象不存在或已删除/);

  // Even direct repository writes must not create an active V2 on a deleted master.
  const first = inspect(s).where("operation_versions", { operation_id: operation.id })[0];
  const later = new Date(Date.parse(first.changed_at) + 1000).toISOString();
  assert.throws(() => inspect(s).insert("operation_versions", {
    ...first, id: "forbidden-new-active-operation-version",
    name: "非法发布的有效操作版本",
    version: operationBefore.version + 1, changed_at: later,
  }), /作业对象不适用于当前操作类型/);

  const operationDeleted = s.catalog.remove(user, "operations", operation.id, operationBefore.version);
  assert.equal(operationDeleted.deleted, true);
  assert.equal(s.catalog.list("operations").some(row => row.id === operation.id), false);
  const archivedOperation = s.catalog.get("operations", operation.id, true);
  assert.equal(archivedOperation.status, "inactive");
  assert.equal(archivedOperation.version, operationBefore.version + 1);
  assert.equal(archivedOperation.work_object_id, oldWorkObjectId);
  assert.equal(s.catalog.history("operations", operation.id).length, 2);
  assert.ok(inspect(s).auditFor("operations", operation.id).some(event => event.action === "delete"));
  assert.throws(() => s.catalog.get("operations", operation.id), /已删除/);
  assert.throws(() => s.catalog.save(user, "prices", {
    title: "新价格不得关联已删除的操作",
    operation_id: operation.id,
    unit_price_fen: 100,
    price_source: "测试", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "测试",
  }), /操作类型不存在或已删除/);

  const priceDeleted = s.catalog.remove(user, "prices", price.id, priceBefore.version_no);
  assert.equal(priceDeleted.deleted, true);
  assert.equal(s.catalog.list("prices").some(row => row.id === price.id), false);
  const archivedPrice = s.catalog.get("prices", price.id, true);
  assert.equal(archivedPrice.deleted, true);
  assert.equal(archivedPrice.status, priceBefore.status);
  assert.equal(archivedPrice.version_no, priceBefore.version_no,
    "deletion is recorded as a tombstone without forging a price version");
  assert.equal(archivedPrice.operation_id, operation.id);
  assert.equal(archivedPrice.operation_version, oldPriceOperationVersion);
  assert.equal(archivedPrice.unit_version, oldPriceUnitVersion);
  assert.equal(s.catalog.history("prices", price.id).length, 1);
  assert.ok(inspect(s).auditFor("prices", price.id).some(event => event.action === "delete"));
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("deletion in normal dependent-first order still works and keeps original master identities", (t) => {
  const { s, user, operation, price, object } = fixture(t);
  s.catalog.remove(user, "prices", price.id, 1);
  s.catalog.remove(user, "operations", operation.id, 1);
  s.catalog.remove(user, "objects", object.id, 1);
  assert.equal(s.catalog.list("prices").length, 0);
  assert.equal(s.catalog.list("operations").length, 0);
  assert.equal(s.catalog.list("objects").length, 0);
  assert.equal(s.catalog.get("prices", price.id, true).operation_id, operation.id);
  assert.equal(s.catalog.get("operations", operation.id, true).work_object_id, object.id);
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});
