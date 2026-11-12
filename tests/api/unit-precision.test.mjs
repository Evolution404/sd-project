import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import {
  quantityPrecisionFromFields, assertQuantityPrecision, unitFieldsWithPrecision,
} from "../../dist/server/shared/quantity-precision.js";

test("formal unit versions validate precision and preserve historic extension fields", t => {
  const { s, user, unit, operation } = fixture(t);
  const old = s.dictionaries.getDictionary("units", unit.id);
  assert.equal(old.quantity_precision, 0, "new unit defaults to integer");
  assert.throws(() => quantityPrecisionFromFields("[]"), /正式版本缺少数量精度/);
  assert.throws(() => quantityPrecisionFromFields('{}'), /正式版本缺少数量精度/);
  assert.deepEqual(JSON.parse(unitFieldsWithPrecision('{"dimension":"length"}', 2)),
    { dimension: "length", quantity_precision: 2 });
  assert.throws(() => assertQuantityPrecision(5000, old.fields_json, "套", "quantity_scaled"),
    e => e.status === 422 && /整数/.test(e.message) && !!e.fields.quantity_scaled);
  assert.equal(assertQuantityPrecision(30000, old.fields_json, "套", "quantity_scaled"), 30000);
  for (const invalid of [-1, 1.5, 5, null, "2"]) {
    assert.throws(() => s.dictionaries.saveDictionary(user, "units",
      { expected_version: 1, quantity_precision: invalid }, unit.id), /数量小数位数/);
  }
  const revised = s.dictionaries.saveDictionary(user, "units",
    { expected_version: 1, quantity_precision: 2, name: "套" }, unit.id);
  assert.equal(revised.quantity_precision, 2);
  assert.deepEqual(s.dictionaries.history("units", unit.id).map(x => x.quantity_precision), [0, 2]);
  assert.equal(assertQuantityPrecision(2500, revised.fields_json, "套", "quantity_scaled"), 2500);
  assert.throws(() => assertQuantityPrecision(2501, revised.fields_json, "套", "quantity_scaled"),
    /最多允许2位小数/);
  assert.equal(s.catalog.get("operations", operation.id).default_unit_version, 1,
    "existing operation remains pinned to its original unit version");
});

test("bird-protection equipment cannot be ordered or installed in fractional sets", t => {
  const { s, user, save, demandInput, unit } = fixture(t);
  assert.throws(() => s.demands.save(user, {
    ...demandInput,
    work_locations: [{ ...demandInput.work_locations[0], quantity_scaled: 5000 }],
  }), e => e.status === 422 && !!e.fields["work_locations.0.quantity_scaled"]);
  const material = save("materials", { name: "防鸟装置", unit_id: unit.id });
  assert.throws(() => s.demands.save(user, {
    ...demandInput,
    materials: [{ material_id: material.id, quantity_scaled: 5000 }],
  }), e => e.status === 422 && !!e.fields["materials.0.quantity_scaled"]);
  assert.equal(s.demands.save(user, {
    ...demandInput,
    materials: [{ material_id: material.id, quantity_scaled: 20000 }],
  }).materials[0].quantity_scaled, 20000);
});

test("explicitly decimal unit allows 0.25 but rejects unsupported finer quantities", t => {
  const { s, user, save, object, towers, demandInput } = fixture(t);
  const unit = save("units", { name: "平方米", quantity_precision: 2 });
  const operation = save("operations", {
    name: "设施表面处理", work_object_id: object.id,
    default_unit_id: unit.id, completion_standard: "处理完成",
  });
  const demand = s.demands.save(user, {
    ...demandInput, operation_id: operation.id,
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: towers[0].id, quantity_scaled: 2500 }],
  });
  assert.equal(demand.quantity_scaled, 2500);
  assert.throws(() => s.demands.save(user, {
    ...demandInput, operation_id: operation.id,
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: towers[1].id, quantity_scaled: 2501 }],
  }), /最多允许2位小数/);
});
