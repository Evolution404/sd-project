import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";
import { errorResponse } from "../../dist/server/platform/http/error-response.js";
import { BusinessError, integer } from "../../dist/server/shared/errors/business-error.js";

test("typed list contract rejects fractional and unsafe pagination while bounding filter inputs", () => {
  const value = parseListQuery(new URLSearchParams({ page: "1.5", page_size: "999", filters: JSON.stringify({ name: "线路", invalid: 5, "x;DROP": "bad" }) }));
  assert.equal(value.page, 1);
  assert.equal(value.page_size, 200);
  assert.deepEqual(value.filters, { name: "线路" });
  assert.equal(parseListQuery(new URLSearchParams({ page: "9007199254740992" })).page, 1);
  assert.deepEqual(parseListQuery(new URLSearchParams({ filters: "null" })).filters, {});
});

test("typed errors preserve field location and stable codes without exposing internal failures", () => {
  assert.deepEqual(errorResponse(new BusinessError("原版本已变化", 409, { expected_version: "请刷新" })), {
    status: 409, body: { code: "VERSION_CONFLICT", message: "原版本已变化", fields: { expected_version: "请刷新" } },
  });
  assert.equal(errorResponse(new Error("UNIQUE constraint failed: users.username")).status, 422);
  assert.equal(errorResponse(new Error("private database path")).body.message, "服务内部错误");
  assert.throws(() => integer("1", "数量"), BusinessError);
});
