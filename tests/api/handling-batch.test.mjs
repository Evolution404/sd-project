import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

test("batch preview has no writes; commits enforce permission, version and all-or-nothing handling", async t => {
  const { s, user, save, operation, towers } = fixture(t);
  const framework = save("frameworks", { name: "批量入库验收", fiscal_year: 2026, limit_fen: 1 });
  const projects = ["第一项目", "第二项目"].map(name => s.projects.save(user, { name, framework_id: framework.id }));
  const demands = towers.map((tower, index) => s.demands.save(user, {
    operation_id: operation.id, problem_description: "批量确认需求" + index,
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
  }));
  s.auth.saveUser(user, { username: "batch-reader", password: "Read-only-2026!", role: "viewer", status: "active" });
  const admin = s.auth.login("admin", "Schema113-test-password").token;
  const reader = s.auth.login("batch-reader", "Read-only-2026!").token;
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.shutdown(resolve)));
  async function post(path, input, token = admin, key = randomUUID()) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api" + path, {
      method: "POST", headers: { Cookie: "sd113=" + token, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
    return { status: response.status, result: await response.json() };
  }

  const items = demands.map(row => ({ id: row.id, expected_version: row.current_version }));
  assert.equal((await post("/demands/confirm-batch/preview", { items }, reader)).status, 403);
  const preview = await post("/demands/confirm-batch/preview", { items });
  assert.equal(preview.status, 200);
  assert.ok(preview.result.every(row => row.reason === "" && row.expected_event_seq === 1));
  assert.ok(demands.every(row => s.demands.get(row.id).status === "pending"));
  const verified = preview.result.map(({ id, expected_version, expected_event_seq }) => ({ id, expected_version, expected_event_seq }));
  assert.equal((await post("/demands/confirm-batch", { items: [verified[0], verified[0]] })).status, 422);
  s.demands.transition(user, demands[2].id, { status: "returned", expected_version: 1, expected_event_seq: 1 });
  assert.equal((await post("/demands/confirm-batch", { items: verified })).status, 409);
  assert.equal(s.demands.get(demands[0].id).status, "pending");
  const refreshed = await post("/demands/confirm-batch/preview", { items });
  assert.match(refreshed.result[2].reason, /仅待确认/);
  const key = randomUUID();
  const confirmed = await post("/demands/confirm-batch", { items: verified.slice(0, 2) }, admin, key);
  assert.deepEqual(confirmed, { status: 200, result: { count: 2 } });
  assert.deepEqual(await post("/demands/confirm-batch", { items: verified.slice(0, 2) }, admin, key), confirmed);
  assert.equal(s.demands.history(demands[0].id).events.length, 2);

  const stock = projects.map(row => ({ id: row.id, expected_version: row.version }));
  assert.equal((await post("/projects/stock-batch", { items: stock }, reader)).status, 403);
  const stockPreview = await post("/projects/stock-batch/preview", { items: stock });
  assert.equal(stockPreview.status, 200);
  assert.ok(stockPreview.result.every(row => row.reason === ""));
  assert.equal(s.projects.get(projects[0].id).status, "reserve");
  s.projects.stock(user, projects[1].id, { expected_version: projects[1].version });
  assert.equal((await post("/projects/stock-batch", { items: stock })).status, 409);
  assert.equal(s.projects.get(projects[0].id).status, "reserve");
  assert.equal((await post("/projects/stock-batch", { items: stock.slice(0, 1) })).result.count, 1);

  const linkPath = "/projects/" + projects[0].id + "/link-batch";
  const links = items.map(row => ({ demand_id: row.id, expected_version: row.expected_version }));
  const linkedPreview = await post(linkPath + "/preview", { links });
  assert.equal(linkedPreview.status, 200);
  assert.deepEqual(linkedPreview.result.map(row => !row.reason), [true, true, false]);
  assert.equal(s.demands.get(demands[0].id).binding, null);
  assert.equal((await post(linkPath, { links: links.slice(0, 2) })).status, 200);
  assert.equal(s.demands.get(demands[0].id).binding.project_id, projects[0].id);
  assert.equal(s.demands.get(demands[1].id).binding.project_id, projects[0].id);
});
