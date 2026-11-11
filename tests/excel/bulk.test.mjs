import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";
for (const count of [100, 1000, 5000])
  test(`${count} complete demands preflight and single atomic batch, retry and stable identities`, async (t) => {
    const { s, user, operation } = fixture(t),
      exchange = createExchange(s),
      timestamp = new Date().toISOString();
    s.repo.transaction(() => {
      for (let i = 0; i < count; i++)
        s.repo.insert("physical_towers", {
          id: `bulk-tower-${i}`,
          tower_code: `BULK-${i}`,
          asset_no: `BULK-${i}`,
          created_by: user.id,
          created_at: timestamp,
          updated_at: timestamp,
        });
    });
    const documents = [],
      work_locations = [];
    for (let i = 0; i < count; i++) {
      documents.push({
        operation_name: operation.name,
        problem_description: "批量巡视事实",
        completion_standard: "安装牢固",
      });
      work_locations.push({
        document_row: i + 2,
        location_kind: "physical_tower",
        asset_no: `BULK-${i}`,
        quantity_scaled: 10000,
      });
    }
    const started = performance.now(),
      buffer = await makeWorkbook("demands", { documents, work_locations });
    const afterWorkbook = performance.now();
    const preview = await exchange.preview(user, "demands", buffer, {
      mode: "create",
    });
    assert.equal(
      preview.issues.length,
      0,
      JSON.stringify(preview.issues.slice(0, 2)),
    );
    assert.equal(preview.summary.created, count);
    const afterPreview = performance.now();
    const result = exchange.commit(user, preview.token, {
      request_key: "bulk5000-import-001",
      atomic: true,
    });
    const afterCommit = performance.now();
    assert.equal(result.results.length, count);
    assert.equal(s.repo.list("v_demand_current").length, count);
    assert.equal(s.repo.list("demand_version_work_locations").length, count);
    assert.deepEqual(
      exchange.commit(user, preview.token, {
        request_key: "bulk5000-import-001",
        atomic: true,
      }),
      result,
    );
    assert.equal(s.repo.integrity().foreignKeys.length, 0);
    console.log(
      "BULK_PHASE_MS",
      JSON.stringify({
        count,
        ...preview.timings_ms,
        ...result.timings_ms,
        workbook: Math.round(afterWorkbook - started),
        preview: Math.round(afterPreview - afterWorkbook),
        commit: Math.round(afterCommit - afterPreview),
      }),
    );
    console.log(
      "BULK_TOTAL_MS",
      count,
      Math.round(performance.now() - started),
    );
  });
