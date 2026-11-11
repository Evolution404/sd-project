import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { id, now } from "../../dist/server/platform/auth/service.js";

test("operation edits retain adopted unit versions, extension identities and original ordering", (t) => {
  const { s, user, unit, operation } = fixture(t);
  s.catalog.save(
    user,
    "units",
    { expected_version: 1, name: "套数新版" },
    unit.id,
  );
  const old = s.standards.getOperation(operation.id);
  inspect(s).insert("operation_versions", {
    ...inspect(s).find("operation_versions", "id", old.current_version_id),
    id: id(),
    version: 2,
    sort_order: 7,
    changed_at: now(),
  });
  const input = {
    expected_version: 2,
    fields_json: [{ label: "现场高度", type: "number", required: false }],
  };
  const changed = s.standards.saveOperation(user, input, operation.id);
  assert.equal(changed.default_unit_version, 1);
  assert.equal(changed.default_unit_id_label, "套");
  assert.equal(changed.sort_order, 7);
  const fieldId = JSON.parse(changed.fields_json)[0].key;
  const revised = s.standards.saveOperation(
    user,
    { ...input, expected_version: 3, name: "正式新名称" },
    operation.id,
  );
  assert.equal(JSON.parse(revised.fields_json)[0].key, fieldId);
  assert.throws(
    () =>
      s.standards.saveOperation(
        user,
        { expected_version: 4, fields_json: JSON.parse(revised.fields_json) },
        operation.id,
      ),
    /没有变化/,
  );
});

test("deletion previews count adopted versions and reject changes between preview and confirmation", (t) => {
  const { s, user, operation, price, demandInput, save } = fixture(t);
  const operationImpact = s.standards.operationImpact(operation.id);
  assert.ok(operationImpact.references > 0);
  s.demands.save(user, demandInput);
  assert.throws(
    () =>
      s.standards.removeOperation(
        user,
        operation.id,
        operationImpact.expected_version,
        operationImpact.references,
      ),
    /引用关系已变化/,
  );
  assert.equal(s.standards.getOperation(operation.id).status, "active");
  const factor = save("factors", {
    name: "专项难度",
    fields_json: { kind: "enum", values: ["普通", "困难"] },
  });
  const factorImpact = s.factors.impact(factor.id);
  s.standards.saveOperation(
    user,
    {
      expected_version: 1,
      pricing_features_json: [
        {
          factor_id: factor.id,
          factor_version: 1,
          source: "manual",
          required: true,
        },
      ],
    },
    operation.id,
  );
  assert.throws(
    () =>
      s.factors.remove(
        user,
        factor.id,
        factorImpact.expected_version,
        factorImpact.references,
      ),
    /引用关系已变化/,
  );
  const current = s.factors.impact(factor.id);
  s.factors.remove(
    user,
    factor.id,
    current.expected_version,
    current.references,
  );
  assert.equal(s.factors.get(factor.id, true).deleted, true);
  assert.equal(
    s.standards.operationPriceFeatures(operation.id, 2).items[0].name,
    "专项难度",
  );
  assert.equal(s.priceRules.impact(price.id).references, 0);
});

test("strict price preview derives explicit adoption, rejects conflicting identities, validates dates without writes", (t) => {
  const { s, user, operation, price } = fixture(t);
  s.standards.saveOperation(
    user,
    { expected_version: 1, name: "新版作业标准" },
    operation.id,
  );
  const original = s.priceRules.get(price.id);
  const before = inspect(s).list("audit_events").length;
  assert.equal(
    s.priceRules.preview(user, {
      ...original,
      existing_id: price.id,
      adopt_latest_operation_version: true,
    }).operation_version,
    2,
  );
  assert.throws(
    () =>
      s.priceRules.preview(user, {
        ...original,
        existing_id: price.id,
        operation_version: 99,
      }),
    /必须与所采用作业标准一致/,
  );
  assert.throws(
    () =>
      s.priceRules.preview(user, {
        ...original,
        existing_id: price.id,
        effective_on: "2026-02-30",
      }),
    /有效日期/,
  );
  assert.equal(
    s.priceRules.preview(user, {
      ...original,
      existing_id: price.id,
      sample_quantity_scaled: 0,
    }).sample,
    null,
  );
  assert.equal(inspect(s).list("audit_events").length, before);
  assert.equal(s.priceRules.history(price.id).length, 1);
});

test("work standards and pricing HTTP use domain pagination, aggregate immutable histories and read-only previews", async (t) => {
  const { s, operation, price } = fixture(t),
    server = httpServer(s);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(url + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "Schema113-test-password",
    }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  for (const kind of ["objects", "operations", "prices", "factors"]) {
    const response = await fetch(
      `${url}/catalog/${kind}?page_size=1&sort=name&direction=asc`,
      { headers: { cookie } },
    );
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(page.items.length <= 1);
    assert.equal(page.page_size, 1);
  }
  const detail = await (
    await fetch(`${url}/catalog/operations/${operation.id}?history=true`, {
      headers: { cookie },
    })
  ).json();
  assert.equal(detail.item.id, operation.id);
  assert.equal(detail.versions.length, 1);
  assert.equal(detail.audits[0].action, "create");
  const count = inspect(s).list("ledger_requests").length;
  const preview = await fetch(url + "/catalog/prices/preview", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...price, existing_id: price.id }),
  });
  assert.equal(preview.status, 200);
  assert.equal(inspect(s).list("ledger_requests").length, count);
});
