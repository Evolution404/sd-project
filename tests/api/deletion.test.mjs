import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
test("logical master deletion cannot be bypassed and formal settlement deletion retains void history", (t) => {
  const { s, user, project, scope, approval, node, save } = approvedFixture(t);
  const item = save("materials", {
    code: "DELETE-M",
    name: "可删除物资",
    unit_id: s.catalog.list("units")[0].id,
  });
  s.catalog.remove(user, "materials", item.id, 1);
  assert.equal(s.catalog.list("materials").length, 0);
  assert.equal(s.catalog.list("materials", true).length, 1);
  assert.throws(
    () =>
      s.catalog.save(
        user,
        "materials",
        { name: "绕过删除", expected_version: 2 },
        item.id,
      ),
    /已删除/,
  );
  let bill = s.finance.saveDraft(user, project.id, {
    number: "DELETE-S",
    approval_version_id: approval.id,
    items: [
      {
        cost_node_id: node.id,
        project_scope_id: scope.id,
        quantity_scaled: 10000,
        amount_fen: 30000,
        evidence: "费用依据",
      },
    ],
    resolutions: [
      { project_scope_id: scope.id, resolved_quantity_scaled: 10000 },
    ],
  });
  bill = s.finance.submit(user, bill.id, {
    expected_version: 0,
    expected_edit_version: 1,
  });
  bill = s.finance.review(user, bill.id, {
    expected_version: 1,
    expected_event_seq: 1,
    action: "approve",
  });
  s.finance.removeSettlement(user, bill.id, {
    expected_version: 1,
    expected_edit_version: 0,
  });
  assert.equal(s.finance.allSettlements().length, 0);
  assert.equal(s.finance.history(bill.id).length, 2);
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    0,
  );
  assert.equal(
    s.finance.close(user, project.id, { expected_version: 3 }).status,
    "closed",
  );
});
