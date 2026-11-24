import { test } from "node:test";
import assert from "node:assert/strict";
import { exactScaledInteger, quantityFitsUnitPrecision } from "../../tests/fixtures/legacy-frontend/web/src/shared/utils/fixed-scale.ts";

test("decimal inputs convert to safe exact scaled business integers without silent rounding", () => {
  for (const [value, precision, expected] of [
    [0.07, 2, 7], [0.25, 4, 2500], [1.25, 2, 125],
    [1e-4, 4, 1], [5e-3, 4, 50], [-0.01, 2, -1],
    [12345.67, 2, 1234567], [0.3, 2, 30],
  ]) assert.equal(exactScaledInteger(value,precision),expected);
  for (const [value, precision] of [
    [1.5, 0], [0.2501, 2], [0.001, 2],
    [1e-7, 4], [1e21, 0], [Infinity, 4], [NaN, 2],
  ]) assert.equal(exactScaledInteger(value,precision),null,String(value));
});
test("unit frozen quantity precision rejects fractional indivisible units", () => {
  assert.equal(quantityFitsUnitPrecision(15000,0),false,"1.5套");
  assert.equal(quantityFitsUnitPrecision(5000,0),false,"0.5个");
  assert.equal(quantityFitsUnitPrecision(2500,2),true,"0.25平方米");
  assert.equal(quantityFitsUnitPrecision(2501,2),false,"0.2501平方米");
  assert.equal(quantityFitsUnitPrecision(10000,-1),false);
  assert.equal(quantityFitsUnitPrecision(10000,5),false);
});


test("exact decimal text accepts only representable amounts without coercion", async () => {
  const { exactScaledDecimalText, formatScaledDecimal } = await import("../../tests/fixtures/legacy-frontend/web/src/shared/utils/fixed-scale.ts");
  for (const [text,scale,expected] of [
    ["0.25",4,2500], ["0.2500",4,2500], ["0.2501",4,2501],
    ["1.5",4,15000],["-1.25",2,-125], ["0.07",2,7],
    ["0.00010",4,1], ["5",0,5],["-0.0001",4,-1],
  ]) assert.equal(exactScaledDecimalText(text,scale),expected,text);
  for (const [text,scale] of [
    ["0.2501",2],["0.5",0],["1.5",0],["1e3",4],
    ["1.200001",4],["9007199254740992",0],
    ["0.".padEnd(10000,"0"),4],["--1",2],[".",4],
  ]) assert.equal(exactScaledDecimalText(text,scale),null,text.slice(0,25));
  assert.equal(formatScaledDecimal(2501,4),"0.2501");
  assert.equal(formatScaledDecimal(5000,4),"0.5");
  assert.equal(formatScaledDecimal(-125,2),"-1.25");
  assert.equal(formatScaledDecimal(9007199254740991,0),"9007199254740991");
});
