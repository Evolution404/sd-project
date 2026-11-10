import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, roundRatio } from "../../dist/server/modules/pricing/calculation.js";
const compute = (mode, quantity, options = {}) =>
  calculate({ pricing_mode: mode, ...options }, quantity);
test("all eight pricing modes and integer half-up boundaries", () => {
  assert.equal(
    compute("fixed", 90000, { unit_price_fen: 10001 }).amount_fen,
    10001,
  );
  assert.equal(
    compute("per_unit", 15000, { unit_price_fen: 101 }).amount_fen,
    152,
  );
  assert.equal(
    compute("base_plus_unit", 30000, {
      base_fee_fen: 10000,
      unit_price_fen: 2000,
    }).amount_fen,
    16000,
  );
  assert.equal(
    compute("quantity_bracket", 20000, {
      quantity_brackets_json: JSON.stringify([
        {
          min_quantity_scaled: 10000,
          max_quantity_scaled: 30000,
          unit_price_fen: 2000,
          base_fee_fen: 5000,
        },
      ]),
    }).amount_fen,
    9000,
  );
  assert.equal(
    compute("progressive_bracket", 50000, {
      parameters: {
        tiers: [
          { up_to_quantity_scaled: 20000, unit_price_fen: 100 },
          { up_to_quantity_scaled: null, unit_price_fen: 50 },
        ],
      },
    }).amount_fen,
    350,
  );
  assert.equal(
    compute("group", 50001, {
      parameters: { group_size_scaled: 20000, group_fee_fen: 1000 },
    }).amount_fen,
    3000,
  );
  assert.equal(
    calculate(
      {
        pricing_mode: "rate",
        parameters: { rate_basis: "materials", rate_basis_points: 600 },
      },
      10000,
      { materials: 12345 },
    ).amount_fen,
    741,
  );
  assert.equal(
    compute("composite", 30000, {
      fee_components_json: [
        {
          coverage_key: "labor",
          formula_mode: "base_plus_unit",
          parameters: { base_fee_fen: 10000, unit_price_fen: 2000 },
        },
        {
          coverage_key: "materials",
          formula_mode: "per_unit",
          parameters: { unit_price_fen: 1000 },
        },
      ],
    }).amount_fen,
    19000,
  );
  assert.equal(
    compute("per_unit", 10000, {
      unit_price_fen: 100,
      parameters: { min_amount_fen: 200, max_amount_fen: 300 },
    }).amount_fen,
    200,
  );
  assert.equal(
    compute("per_unit", 100000, {
      unit_price_fen: 100,
      parameters: { max_amount_fen: 300 },
    }).amount_fen,
    300,
  );
  assert.equal(roundRatio(1n, 2n), 1n);
  assert.throws(
    () =>
      compute("per_unit", Number.MAX_SAFE_INTEGER, {
        unit_price_fen: Number.MAX_SAFE_INTEGER,
      }),
    /范围/,
  );
  assert.throws(
    () =>
      compute("group", 10000, {
        parameters: { group_size_scaled: 0, group_fee_fen: 100 },
      }),
    /容量/,
  );
  assert.throws(
    () =>
      compute("rate", 10000, {
        parameters: { rate_basis: "materials", rate_basis_points: 100 },
      }),
    /基数/,
  );
});
