import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { assertQuantityPrecision, quantityPrecisionFromFields } from "../../dist/server/shared/quantity-precision.js";

test("unit precision is exact and integral units reject fractional device counts on demand and materials", t => {
  const { s, user, unit, demandInput } = fixture(t);
  assert.equal(unit.quantity_precision, 0);
  assert.equal(quantityPrecisionFromFields(unit.fields_json), 0);
  const halfDevice = structuredClone(demandInput);
  halfDevice.work_locations[0].quantity_scaled = 5000;
  assert.throws(() => s.demands.save(user, halfDevice), problem => {
    assert.equal(problem.status, 422);
    assert.match(problem.message, /整数/);
    assert.match(problem.fields["work_locations.0.quantity_scaled"], /整数/);
    return true;
  });
  const material = s.materials.save(user, { name: "防鸟装置物资", unit_id: unit.id });
  assert.throws(() => s.demands.save(user, {
    ...demandInput,
    materials: [{ material_id: material.id, quantity_scaled: 15000 }],
  }), problem => {
    assert.equal(problem.status, 422);
    assert.match(problem.fields["materials.0.quantity_scaled"], /整数/);
    return true;
  });
  assert.throws(() => assertQuantityPrecision(10001, unit.fields_json, "套", "quantity_scaled"), /整数/);
  assert.equal(assertQuantityPrecision(20000, unit.fields_json, "套", "quantity_scaled"), 20000);
});

test("new operation versions adopt revised unit precision while existing demand snapshots stay frozen", t => {
  const { s, user, unit, operation, demandInput, towers } = fixture(t);
  const original = s.demands.save(user, {
    ...demandInput,
    work_locations: [demandInput.work_locations[0]],
  });
  assert.equal(original.unit_version, 1);
  const revisedUnit = s.dictionaries.saveDictionary(user, "units", {
    quantity_precision: 2, expected_version: 1,
  }, unit.id);
  assert.equal(revisedUnit.version, 2);
  assert.equal(revisedUnit.quantity_precision, 2);
  assert.equal(s.dictionaries.history("units", unit.id)[0].quantity_precision, 0);
  const revisedOperation = s.catalog.save(user, "operations", {
    expected_version: 1, adopt_current_unit: true,
  }, operation.id);
  assert.equal(revisedOperation.default_unit_version, 2);
  assert.equal(s.demands.get(original.id).unit_version, 1);
  const fractional = s.demands.save(user, {
    ...demandInput,
    work_locations: [{
      location_kind: "physical_tower",
      physical_tower_id: towers[2].id,
      quantity_scaled: 12500,
    }],
  });
  assert.equal(fractional.operation_version, 2);
  assert.equal(fractional.unit_version, 2);
  assert.equal(fractional.quantity_scaled, 12500);
  assert.throws(() => s.demands.save(user, {
    ...demandInput,
    work_locations: [{
      location_kind: "physical_tower",
      physical_tower_id: towers[1].id,
      quantity_scaled: 12345,
    }],
  }), /最多允许2位小数/);
  assert.throws(() => s.dictionaries.saveDictionary(user, "units", {
    quantity_precision: 5, expected_version: 2,
  }, unit.id), /0至4/);
});

test("development-stage missing precision is integral and corrected on the next unit version", t => {
  const { s, user, unit } = fixture(t);
  assert.equal(quantityPrecisionFromFields("[]"), 0);
  assert.equal(quantityPrecisionFromFields("{}"), 0);
  assert.throws(() => assertQuantityPrecision(5000, "[]", "套", "quantity_scaled"), /整数/);
  const revision = s.dictionaries.saveDictionary(user, "units", {
    name: "已明确补齐的套", expected_version: 1,
  }, unit.id);
  assert.deepEqual(JSON.parse(revision.fields_json), { quantity_precision: 0 });
});
