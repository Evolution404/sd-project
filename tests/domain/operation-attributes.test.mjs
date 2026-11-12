import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAttributeSchema, normalizeAttributeValues, validateAttributeCondition, attributeNumber } from "../../dist/server/shared/operation-attributes.js";

const base = { key: "bird", label: "鸟害等级", scope: "location", source: "manual", type: "select",
  requirement: "save", pricing: true, enabled: true, sort_order: 1, hint: "按现场填写",
  options: [{ value: "high", label: "高" }, { value: "low", label: "低" }] };
test("unified attributes validate all eight types, levels, stable options, save requirements and bounds", () => {
  const fields = validateAttributeSchema([base,
    { ...base, key: "reason", label: "治理原因", scope: "demand", type: "textarea", pricing: false },
    { ...base, key: "text", label: "说明", type: "text", pricing: false, requirement: "optional" },
    { ...base, key: "count", label: "数量", type: "integer", precision: 0, min: "-2", max: "20" },
    { ...base, key: "height", label: "高度", type: "decimal", precision: 2, min: "0", max: "20.25" },
    { ...base, key: "tags", label: "分类", type: "multiselect", pricing: false },
    { ...base, key: "special", label: "特殊条件", type: "boolean" },
    { ...base, key: "date", label: "发现日期", type: "date", pricing: false }]);
  const values = { bird: "high", count: -1, height: "0.25", tags: ["high"], special: false, date: "2026-11-12" };
  assert.deepEqual(normalizeAttributeValues(fields, "location", values, "work_locations.row-1.attributes"), values);
  assert.deepEqual(normalizeAttributeValues(fields, "demand", { reason: "现场治理" }, "attributes"), { reason: "现场治理" });
  for (const [key, value, message] of [["bird", "invalid", /正式选项/], ["count", 0.5, /整数/],
    ["count", 21, /范围/], ["height", "0.251", /2位/], ["height", 0.25, /小数文本/],
    ["tags", ["high", "high"], /不重复/], ["date", "2026-02-30", /日期无效/]])
    assert.throws(() => normalizeAttributeValues(fields, "location", { ...values, [key]: value }, "locations.row-1.attributes"), message);
  assert.throws(() => normalizeAttributeValues(fields, "location", { ...values, reason: "错误层级" }, "locations"), /正确层级/);
  assert.throws(() => normalizeAttributeValues(fields, "location", {}, "locations.row-2.attributes"), error =>
    error.fields["locations.row-2.attributes.bird"] === "请填写鸟害等级");
});
test("pricing eligibility, deferred requirements, disabled fields and exact signed decimals", () => {
  assert.throws(() => validateAttributeSchema([{ ...base, type: "textarea" }]), /不支持参与计价/);
  assert.throws(() => validateAttributeSchema([base, base]), /不能重复/);
  assert.throws(() => validateAttributeSchema([{ ...base, options: [{ value: "a", label: "甲" }, { value: "a", label: "乙" }] }]), /不能重复/);
  assert.deepEqual(normalizeAttributeValues([{ ...base, requirement: "pricing" }], "location", {}, "locations"), {});
  assert.deepEqual(normalizeAttributeValues([{ ...base, enabled: false }], "location", {}, "locations"), {});
  validateAttributeCondition(base, { op: "eq", value: "high" });
  assert.throws(() => validateAttributeCondition(base, { op: "range", min: 1, max: 2 }), /只支持/);
  const decimal = { ...base, type: "decimal", precision: 4, min: "-1", max: "1" };
  validateAttributeCondition(decimal, { op: "range", min: "-0.2501", max: "0.1" });
  assert.equal(attributeNumber("-0.2501", 4, "数值"), -2501n);
  assert.equal(attributeNumber("0.0001", 4, "数值"), 1n);
  assert.throws(() => attributeNumber("0.00001", 4, "数值"), /4位/);
  assert.throws(() => validateAttributeCondition(decimal, { op: "range", min: "1", max: "-1" }), /范围/);
});
test("equipment facts are referenced from real assets and cannot be edited independently", () => {
  const field = { ...base, key: "tower", label: "塔型", source: "asset", asset_field: "tower_type", options: [] };
  validateAttributeSchema([field]);
  assert.deepEqual(normalizeAttributeValues([field], "location", {}, "locations", { tower_type: "角钢塔" }), { tower: "角钢塔" });
  assert.throws(() => normalizeAttributeValues([field], "location", { tower: "另一塔型" }, "locations", { tower_type: "角钢塔" }), /真实台账/);
  assert.throws(() => validateAttributeSchema([{ ...field, source: "manual", asset_field: undefined }]), /台账引用/);
});
