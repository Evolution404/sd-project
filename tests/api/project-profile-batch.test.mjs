import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../helpers.mjs";

test("project profile workbooks preview without facts and roll back stale batches", t => {
  const { s, user, save } = fixture(t);
  const framework = save("frameworks", { fiscal_year: 2026, name: "档案工作表夹具框架", limit_fen: 1000000 });
  const rows = [
    { ref: "1", values: { name: "档案批量甲", framework_id: framework.id, preliminary_estimate_fen: 12500 } },
    { ref: "2", values: { name: "档案批量乙", framework_id: framework.id, planned_start_on: "2026-02-31" } },
  ];
  const bad = s.projects.previewProfileBatch(user, rows);
  assert.deepEqual(bad.issues.map(issue => [issue.ref, issue.field]), [["2", "planned_start_on"]]);
  assert.equal(bad.fingerprint, undefined);
  assert.equal(s.projects.search({ page: 1, page_size: 20, q: "档案批量", filters: {} }).total, 0);

  rows[1].values.planned_start_on = "2026-12-01";
  const checked = s.projects.previewProfileBatch(user, rows);
  assert.deepEqual(checked.issues, []);
  const saved = s.projects.commitProfileBatch(user, rows, checked.fingerprint);
  assert.equal(saved.results.length, 2);
  const [a, b] = saved.results.map(row => s.projects.get(row.id));
  assert.equal(a.preliminary_estimate_fen, 12500);
  assert.equal(b.planned_start_on, "2026-12-01");
  assert.equal(b.funding?.agreement_id ?? null, null);

  const updates = [a, b].map(project => ({
    ref: project.code, id: project.id, values: {
      name: project.name + "修订", expected_version: project.profile_version, expected_funding_version: 0,
    },
  }));
  const prepared = s.projects.previewProfileBatch(user, updates);
  assert.deepEqual(prepared.issues, []);
  assert.throws(() => s.projects.commitProfileBatch(user, updates, "0".repeat(64)), /内容已变化/);
  s.projects.save(user, { name: "并发修订乙", expected_version: b.profile_version }, b.id);
  assert.throws(() => s.projects.commitProfileBatch(user, updates, prepared.fingerprint), /全部未写入/);
  assert.equal(s.projects.get(a.id).profile_version, a.profile_version);
  assert.equal(s.projects.get(a.id).name, "档案批量甲");
  assert.equal(s.projects.get(b.id).name, "并发修订乙");
  assert.throws(() => s.projects.previewProfileBatch({ ...user, permissions: ["read"] }, updates), error => error.status === 403);
});
