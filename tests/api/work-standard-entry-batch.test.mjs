import assert from "node:assert/strict";
import test from "node:test";
import { fixture, attribute } from "../helpers.mjs";
import { validateWorksheetOptionLabels } from "../../dist/server/shared/operation-attributes.js";

test("work standard batches are atomic and preserve adopted object, unit and attribute identities", t => {
  const { s, user, object, unit, operation } = fixture(t);
  const batch = (kind, input, commit = false) => s.standards.entryBatch(user, kind, input, commit);
  const objects = { rows: [
    { ref: "1", values: { name: "批量对象一", object_position: "body", attribution_unit: "physical_tower" } },
    { ref: "2", values: { name: "批量对象二", object_position: "corridor", attribution_unit: "logical_tower" } },
  ] };
  const draft = batch("objects", objects);
  assert.equal(s.standards.searchObjects({ page: 1, page_size: 20, q: "批量对象", filters: {} }).total, 0);
  const created = batch("objects", { ...objects, fingerprint: draft.fingerprint }, true);
  assert.equal(s.standards.getObject(created.ids[1]).attribution_unit, "logical_tower");
  const original = s.standards.saveOperation(user, {
    attributes_schema_json: [attribute()], expected_version: operation.version,
  }, operation.id);
  const operations = { rows: [
    { ref: "1", id: original.id, values: { name: "批量操作修订", expected_version: original.version, completion_standard: "批量验收" } },
    { ref: "2", values: { name: "批量操作新增", work_object_id: object.id, default_unit_id: unit.id, default_quantity_scaled: 20000 } },
  ] };
  const proof = batch("operations", operations);
  s.standards.saveOperation(user, { entry_hint: "并发版本", expected_version: original.version }, original.id);
  assert.throws(() => batch("operations", { ...operations, fingerprint: proof.fingerprint }, true), fault =>
    fault.status === 409 && fault.fields.batch_id === "1");
  assert.equal(s.standards.searchOperations({ page: 1, page_size: 20, q: "批量操作", filters: {} }).total, 0);
  operations.rows[0].values.expected_version++;
  const saved = batch("operations", { ...operations, fingerprint: batch("operations", operations).fingerprint }, true);
  assert.equal(s.standards.getOperation(saved.ids[1]).default_quantity_scaled, 20000);
  const updated = s.standards.getOperation(saved.ids[0]);
  assert.equal(updated.attributes_schema_json, original.attributes_schema_json);
  assert.equal(updated.default_unit_version, original.default_unit_version);
  assert.equal(updated.work_object_version_no, original.work_object_version_no);
});

test("new ambiguous worksheet option labels fail while frozen historical labels remain readable", t => {
  const { s, user, operation } = fixture(t);
  const field = attribute({ options: [{ value: "a", label: "现场,巡视" }, { value: "b", label: "重复" }, { value: "c", label: "重复" }] });
  assert.throws(() => s.standards.saveOperation(user, { expected_version: operation.version, attributes_schema_json: [field] }, operation.id),
    fault => /保留的分隔符/.test(fault.fields.attributes_schema_json));
  assert.doesNotThrow(() => validateWorksheetOptionLabels([field], [field]));
  assert.throws(() => validateWorksheetOptionLabels([{ ...field, options: [...field.options, { value: "d", label: "重复" }] }], [field]));
});
