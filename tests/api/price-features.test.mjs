import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("extra factor definitions reject empty/duplicate enums and out-of-range integers", (t) => {
  const { s, user, save, unit } = fixture(t);
  assert.throws(() => save("factors", {
    name: "空选项",
    fields_json: { kind: "enum", values: [] },
  }), /至少配置一个可选值/);
  assert.throws(() => save("factors", {
    name: "重复选项",
    fields_json: { kind: "enum", values: ["困难", "困难"] },
  }), /不能重复/);
  assert.throws(() => save("factors", {
    name: "不合法区间",
    fields_json: { kind: "number", min: 8, max: 2 },
  }), /最小值不能大于最大值/);
  assert.throws(() => save("factors", {
    name: "非法台账特征",
    fields_json: { kind: "enum", values: ["220kV"], asset_field: "voltage_name" },
  }), /台账属性应直接作为价格适用条件/);
  assert.throws(() => save("factors", {
    name: "塔型",
    fields_json: { kind: "enum", values: ["角钢塔"] },
  }), /已有正式业务字段/);
  assert.throws(() => save("factors", {
    name: "未知单位",
    fields_json: { kind: "number", unit_id: "nonexistent", unit_version: 1 },
  }), /不存在/);
  const integer = save("factors", {
    name: "吊装高度", code: "hoist-height",
    fields_json: { kind: "number", unit_id: unit.id, unit_version: 1, min: 0, max: 200 },
  });
  assert.deepEqual(JSON.parse(integer.fields_json), {
    kind: "number", unit_id: unit.id, unit_version: 1, min: 0, max: 200,
  });
  const changed = s.catalog.save(user, "factors", {
    name: "吊装最大高度", expected_version: 1,
  }, integer.id);
  assert.equal(changed.version, 2);
  assert.equal(s.catalog.history("factors", integer.id)[0].name, "吊装高度");
  s.catalog.save(user, "units", { name: "套数", expected_version: 1 }, unit.id);
  const renamed = s.catalog.save(user, "factors", {
    name: "吊装高度（新版名称）", expected_version: 2,
  }, integer.id);
  assert.equal(renamed.version, 3);
  assert.equal(JSON.parse(renamed.fields_json).unit_version, 1);
});

test("required extra site facts defer demand registration but block a complete quote; overlap warns", (t) => {
  const { s, user, save, operation, unit, demandInput, towers } = fixture(t);
  const factor = save("factors", {
    name: "施工难度", code: "difficulty",
    fields_json: { kind: "enum", values: ["普通", "困难"] },
  });
  const height = save("factors", {
    name: "高度", code: "height",
    fields_json: { kind: "number", unit_id: unit.id, unit_version: 1, min: 0, max: 100 },
  });
  assert.throws(() => s.catalog.save(user, "operations", {
    expected_version: 1,
    pricing_features_json: [
      { factor_id: factor.id, factor_version: 1, source: "asset", required: true },
    ],
  }, operation.id), /只能使用现场填写/);
  const newOp = s.catalog.save(user, "operations", {
    expected_version: 1,
    pricing_features_json: [
      { factor_id: factor.id, factor_version: 1, source: "manual", required: true },
      { factor_id: height.id, factor_version: 1, source: "manual", required: false },
    ],
  }, operation.id);
  assert.equal(newOp.version, 2);
  const incomplete = s.demands.save(user, {
    ...demandInput, demand_no: "MISSING-FACT",
    work_locations: [demandInput.work_locations[0]],
  });
  const missing = s.pricing.quote(user, incomplete.id, { expected_version: 1 });
  assert.equal(missing.complete, false);
  assert.match(missing.missing[0].reason, /施工难度/);
  assert.throws(() => s.pricing.quote(user, incomplete.id, {
    expected_version: 1, confirm: true,
  }), /未完整计价/);
  assert.throws(() => s.demands.save(user, {
    ...demandInput, demand_no: "WRONG-ENUM",
    work_locations: [{
      ...demandInput.work_locations[0],
      site_features_json: {
        [factor.code]: { factor_version: 1, value: "未知难度" },
      },
    }],
  }), /不在正式选项/);
  assert.throws(() => s.demands.save(user, {
    ...demandInput, demand_no: "WRONG-HEIGHT",
    work_locations: [{
      ...demandInput.work_locations[0],
      site_features_json: {
        [factor.code]: { factor_version: 1, value: "困难" },
        [height.code]: { factor_version: 1, value: 101 },
      },
    }],
  }), /不在允许的数值范围/);

  assert.throws(() => save("prices", {
    title: "无效施工难度", operation_id: operation.id, pricing_mode: "per_unit",
    unit_price_fen: 1000,
    additional_conditions_json: {
      [factor.code]: { factor_version: 1, op: "eq", value: "不存在" },
    },
    price_source: "测试", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "测试",
  }), /不在正式选项/);
  const price = save("prices", {
    title: "困难施工", operation_id: operation.id, pricing_mode: "per_unit",
    unit_price_fen: 1000,
    additional_conditions_json: {
      [factor.code]: { factor_version: 1, op: "eq", value: "困难" },
      [height.code]: { factor_version: 1, op: "range", min: 10, max: 100 },
    },
    price_source: "测试", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "验收测试",
  });
  assert.equal(price.warnings, undefined);

  const demand = s.demands.save(user, {
    ...demandInput, demand_no: "PRICED-FACT",
    work_locations: [
      { ...demandInput.work_locations[1],
        site_features_json: {
          [factor.code]: { factor_version: 1, value: "困难" },
          [height.code]: { factor_version: 1, value: 15 },
        },
      },
    ],
  });
  const quote = s.pricing.quote(user, demand.id, { expected_version: 1 });
  assert.equal(quote.complete, true);
  assert.equal(quote.total_fen, 2000);
  assert.equal(s.pricing.quote(user, demand.id, {
    expected_version: 1, confirm: true,
  }).total_fen, 2000);
  const overlapping = save("prices", {
    title: "困难施工重叠", operation_id: operation.id, pricing_mode: "fixed",
    unit_price_fen: 10000,
    additional_conditions_json: {
      [factor.code]: { factor_version: 1, op: "eq", value: "困难" },
    },
    price_source: "测试", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "验收测试",
  });
  assert.match(overlapping.warnings?.[0] || "", /困难施工/);
  const ambiguous = s.pricing.quote(user, demand.id, { expected_version: 1 });
  assert.equal(ambiguous.complete, false);
  assert.match(ambiguous.missing[0].reason, /重叠规则/);
  assert.equal(ambiguous.missing[0].candidates.length, 2);
});
test("price rule edit preserves adopted operation version until explicit upgrade and explains mismatches", (t) => {
  const { s, user, operation, price, demandInput } = fixture(t);
  const changed = s.catalog.save(user, "operations", {
    name: "安装防鸟装置 · 新验收定义",
    expected_version: 1,
  }, operation.id);
  assert.equal(changed.version, 2);

  const previous = s.catalog.get("prices", price.id);
  const preview = s.catalog.previewPrice(user, {
    ...previous, existing_id: price.id,
  });
  assert.equal(preview.operation_version, 1);
  const edited = s.catalog.save(user, "prices", {
    title: "仅修订价格来源说明",
    expected_version: 1,
  }, price.id);
  assert.equal(edited.operation_version, 1);
  assert.equal(edited.version_no, 2);
  assert.equal(s.catalog.history("prices", price.id).length, 2);

  const newer = s.catalog.previewPrice(user, {
    ...s.catalog.get("prices", price.id),
    existing_id: price.id,
    adopt_latest_operation_version: true,
  });
  assert.equal(newer.operation_version, 2);
  const adopted = s.catalog.save(user, "prices", {
    expected_version: 2, adopt_latest_operation_version: true,
  }, price.id);
  assert.equal(adopted.operation_version, 2);

  const demand = s.demands.save(user, demandInput);
  const quote = s.pricing.quote(user, demand.id, {
    expected_version: 1, pricing_date: "2026-11-09",
  });
  assert.equal(quote.complete, true);
  assert.equal(quote.lines[0].rule_title, adopted.title);
  assert.equal(quote.lines[0].rule_version_no, 3);
  assert.match(JSON.stringify(quote.lines[0].calculation_trace_json), /mode/);

  // Changing the current price version to a different operation version
  // produces a specific, user-facing diagnostic instead of opaque "no price".
  s.catalog.save(user, "operations", {
    name: "安装防鸟装置 · 第三版", expected_version: 2,
  }, operation.id);
  const alternativeTower = s.catalog.save(user, "physical", {
    asset_no: "DIA-T18", tower_type: "angle",
  });
  const newerDemand = s.demands.save(user, {
    ...demandInput,
    demand_no: "DIAGNOSTIC-ALT",
    work_locations: [{
      location_kind: "physical_tower",
      physical_tower_id: alternativeTower.id, quantity_scaled: 10000,
    }],
  });
  const missing = s.pricing.quote(user, newerDemand.id, {
    expected_version: 1, pricing_date: "2026-11-09",
  });
  assert.equal(missing.complete, false);
  assert.match(JSON.stringify(missing.missing[0].diagnostics),
    /正式版本不同/);
});