import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";

function input(f) {
  return { approval_version_id: f.approval.id,
    items: [{ cost_node_id: f.node.id, project_scope_id: f.scope.id,
      amount_fen: 10000, quantity_scaled: 10000, evidence: "模拟结算" }],
    resolutions: [{ project_scope_id: f.scope.id, resolved_quantity_scaled: 10000 }] };
}
function approvedBill(f) {
  let bill = f.s.finance.saveDraft(f.user, f.project.id, input(f));
  bill = f.s.finance.submit(f.user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  return f.s.finance.review(f.user, bill.id,
    { expected_version: 1, expected_event_seq: 1, action: "approve" });
}
test("withdrawal checks the adopted formal version and retains the approved settlement", t => {
  const f = approvedFixture(t), bill = approvedBill(f);
  f.s.finance.saveDraft(f.user, f.project.id,
    { ...input(f), expected_version: 1, expected_edit_version: 0 }, bill.id);
  assert.throws(() => f.s.finance.discardDraft(f.user, bill.id,
    { expected_version: 0, expected_edit_version: 1 }), e => e.status === 409);
  f.s.finance.discardDraft(f.user, bill.id, { expected_version: 1, expected_edit_version: 1 });
  assert.equal(f.s.finance.settlement(bill.id).version.id, bill.version.id);
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen, 10000);
  const audit = inspect(f.s).list("audit_events").find(a => a.entity === "settlement_drafts" && a.entity_id === bill.id);
  assert.equal(audit.action, "withdraw");
  assert.equal(JSON.parse(audit.before_json).edit_version, 1);
  assert.throws(() => f.s.finance.discardDraft(f.user, bill.id,
    { expected_version: 1, expected_edit_version: 0 }), e => e.status === 409);
});
test("a withdrawn draft edit token cannot withdraw a newly recreated draft", t => {
  const f = approvedFixture(t), bill = approvedBill(f);
  const revision = { ...input(f), expected_version: 1, expected_edit_version: 0 };
  f.s.finance.saveDraft(f.user, f.project.id, revision, bill.id);
  f.s.finance.discardDraft(f.user, bill.id, { expected_version: 1, expected_edit_version: 1 });
  const next = f.s.finance.saveDraft(f.user, f.project.id, revision, bill.id);
  assert.equal(next.draft.edit_version, 2);
  assert.throws(() => f.s.finance.discardDraft(f.user, bill.id,
    { expected_version: 1, expected_edit_version: 1 }), e => e.status === 409);
  assert.equal(f.s.finance.settlement(bill.id).draft.edit_version, 2);
});
test("withdrawing an initial draft hides its identity and permits formal closure", t => {
  const f = approvedFixture(t), bill = f.s.finance.saveDraft(f.user, f.project.id, input(f));
  f.s.finance.discardDraft(f.user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  assert.equal(f.s.finance.settlements(f.project.id).length, 0);
  assert.equal(f.s.finance.allSettlements(true).find(b => b.id === bill.id).deleted, true);
  assert.ok(inspect(f.s).find("settlements", "id", bill.id));
  f.s.finance.close(f.user, f.project.id, { expected_version: f.project.version });
  assert.equal(f.s.projects.get(f.project.id).status, "closed");
});

test("HTTP withdrawal enforces roles and supports an idempotent editor retry", async t => {
  const { httpServer } = await import("../../dist/server/platform/http/server.js");
  const { randomUUID } = await import("node:crypto");
  const f = approvedFixture(t), bill = f.s.finance.saveDraft(f.user, f.project.id, input(f));
  const tokens = {};
  for (const role of ["editor", "verifier", "viewer"]) {
    const username = "withdraw-" + role, password = "Withdrawal-Test-" + role;
    f.s.auth.saveUser(f.user, { username, password, role, status: "active" });
    tokens[role] = f.s.auth.login(username, password).token;
  }
  const server = httpServer(f.s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = { expected_version: 0, expected_edit_version: 1 };
  async function request(role, key = randomUUID()) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/settlements/${bill.id}/draft`, {
      method: "DELETE", headers: { Cookie: "sd113=" + tokens[role],
        "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
    });
  }
  for (const role of ["viewer", "verifier"]) assert.equal((await request(role)).status, 403);
  assert.equal(f.s.finance.settlement(bill.id).draft.edit_version, 1);
  const key = randomUUID();
  assert.equal((await request("editor", key)).status, 200);
  assert.equal((await request("editor", key)).status, 200);
  assert.equal((await request("editor")).status, 409);
  const audits = inspect(f.s).list("audit_events").filter(a => a.entity === "settlement_drafts" && a.entity_id === bill.id);
  assert.equal(audits.length, 1);
});
