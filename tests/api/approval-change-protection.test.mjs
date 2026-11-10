import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystem } from "../../server/application/system.mjs";import { httpServer } from "../../server/http/server.mjs";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

function demo(t) {
  const root = mkdtempSync(join(tmpdir(), "sd-approval-protection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "demo");
  ensureDemoDatabase(dir);
  const s = createSystem(dir);
  t.after(() => s.close());
  const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
  const project = s.projects.list().find(item => item.status === "approved");
  const approval = project.approvals.find(ap => ap.id === project.approval.id);
  const scope = approval.scopes[0];
  const demand = s.demands.get(scope.demand_id);
  return { s, user, project, approval, scope, demand };
}
function draftInput({ project, approval, scope, demand }, materials) {
  return {
    expected_version: project.version,
    expected_approval_version_id: approval.id,
    approved_budget_fen: approval.approved_budget_fen,
    scopes: [{
      project_scope_id: scope.project_scope_id,
      demand_version: demand.current_version,
      locations: scope.locations.length
        ? scope.locations.map(loc => ({
          location_item_no: loc.location_item_no,
          approved_quantity_scaled: loc.approved_quantity_scaled,
        }))
        : [{ location_item_no: 1, approved_quantity_scaled: scope.quantity_scaled }],
      materials,
    }],
  };
}
test("formal change without explicit scope change inherits all approved material quantities", t => {
  const setup = demo(t);
  const { s, user, project, approval, scope } = setup;
  assert.equal(scope.materials.length, 1);
  assert.ok(scope.materials[0].material_id);
  const input = draftInput(setup, scope.materials.map(item => ({
    material_id: item.material_id,
    quantity_scaled: item.approved_quantity_scaled,
  })));
  let after = s.projects.approvalDraft(user, project.id, input);
  const change = after.approvals.find(ap => ap.status === "draft");
  assert.equal(change.scopes[0].materials.length, 1);
  assert.equal(change.scopes[0].materials[0].approved_quantity_scaled, 50000);
  after = s.projects.approve(user, project.id, change.id, { expected_version: after.version });
  const current = after.approvals.find(ap => ap.id === after.approval.id);
  assert.equal(current.scopes[0].materials.length, 1);
  assert.equal(current.scopes[0].materials[0].approved_quantity_scaled, 50000);
  const original = after.approvals.find(ap => ap.id === approval.id);
  assert.equal(original.scopes[0].materials.length, 1);
});
test("server rejects silently dropped materials and accepts explicit reviewed removal", t => {
  const setup = demo(t);
  const { s, user, project, approval, scope } = setup;
  const input = draftInput(setup, []);
  assert.throws(() => s.projects.approvalDraft(user, project.id, input),
    /核对差异并明确确认/);
  assert.equal(s.projects.get(project.id).approvals.length, 1);
  input.confirm_changes = true;
  let after = s.projects.approvalDraft(user, project.id, input);
  const change = after.approvals.find(ap => ap.status === "draft");
  assert.equal(change.scopes[0].materials.length, 0);
  after = s.projects.approve(user, project.id, change.id, { expected_version: after.version });
  assert.equal(after.approval.version_no, 2);
  assert.equal(after.approvals.find(ap => ap.id === approval.id).scopes[0].materials.length, 1);
});
test("reference quote confirm must match the previewed price versions and amounts", t => {
  const setup = demo(t);
  const { s, user, demand } = setup;
  const base = { expected_version: demand.current_version, pricing_date: "2026-11-10" };
  const before = s.repo.where("reference_price_evaluations", { demand_id: demand.id }).length;
  const preview = s.pricing.quote(user, demand.id, base);
  assert.equal(preview.complete, true);
  assert.ok(preview.preview_hash);
  assert.throws(() => s.pricing.quote(user, demand.id, {
    ...base, confirm: true, preview_hash: "outdated-result",
  }), /重新试算/);
  assert.equal(s.repo.where("reference_price_evaluations", { demand_id: demand.id }).length, before);
  const saved = s.pricing.quote(user, demand.id, {
    ...base, confirm: true, preview_hash: preview.preview_hash,
  });
  assert.equal(saved.total_fen, preview.total_fen);
  assert.ok(saved.id);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
test("HTTP requires a matching trial quote before formal price confirmation", async t => {
  const setup = demo(t);
  const { s, demand } = setup;
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: DEMO_ACCOUNT, password: DEMO_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const endpoint = base + "/api/demands/" + demand.id + "/quote";
  let requestNo = 0;
  const post = data => fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie,
      "Idempotency-Key": "quote-preview-protection-" + (++requestNo) },
    body: JSON.stringify(data),
  });
  const input = { expected_version: demand.current_version, pricing_date: "2026-11-10" };
  const previewResponse = await post(input);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.preview_hash);
  const noPreview = await post({ ...input, confirm: true });
  assert.equal(noPreview.status, 422);
  const stale = await post({ ...input, confirm: true, preview_hash: "0".repeat(64) });
  assert.equal(stale.status, 409, JSON.stringify(await stale.json()));
  const confirmed = await post({ ...input, confirm: true, preview_hash: preview.preview_hash });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).total_fen, preview.total_fen);
});
