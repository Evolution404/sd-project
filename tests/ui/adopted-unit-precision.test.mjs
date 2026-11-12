import {test} from "node:test";
import assert from "node:assert/strict";
import { requireAdoptedQuantityPrecision } from "../../web/src/shared/utils/adopted-unit-precision.ts";

test("adopted quantity must use exact frozen formal version, never latest", () => {
  const versions=[
    {version:1, quantity_precision:0},
    {version:2, quantity_precision:2},
    {version:3, quantity_precision:4},
  ];
  assert.equal(requireAdoptedQuantityPrecision(versions,1),0);
  assert.equal(requireAdoptedQuantityPrecision(versions,2),2);
  assert.equal(requireAdoptedQuantityPrecision(versions,3),4);
  assert.throws(()=>requireAdoptedQuantityPrecision(versions,4),/不存在/);
  assert.throws(()=>requireAdoptedQuantityPrecision(versions,0),/无效/);
});
test("invalid or absent precision must be rejected, not inferred as four", () => {
  for (const fields of [{version:1},{version:1,quantity_precision:null},
    {version:1,quantity_precision:2.5},{version:1,quantity_precision:-1},
    {version:1,quantity_precision:5}]) {
    assert.throws(()=>requireAdoptedQuantityPrecision([fields],1),/缺少有效数量精度/);
  }
});
