import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { createReferences } from "../../dist/server/modules/exchange/references.mjs";

test("Excel project, demand scope and cost path use one query per index per preparation", t => {
  const { s, user, project, scope, node } = approvedFixture(t);
  const child = s.finance.node(user, project.id, { parent_id: node.id, name: "分项成本" });
  const calls = { project: 0, scope: 0, cost: 0 };
  const repo = {
    ...s.repo,
    exchangeProjectCandidates(...args) {
      calls.project++;
      return s.repo.exchangeProjectCandidates(...args);
    },
    exchangeScopeCandidates(...args) {
      calls.scope++;
      return s.repo.exchangeScopeCandidates(...args);
    },
    exchangeCostPaths(...args) {
      calls.cost++;
      return s.repo.exchangeCostPaths(...args);
    },
  };
  const refs = createReferences({ ...s, repo });
  const description = s.demands.get(scope.demand_id).problem_description;
  for (let i = 0; i < 5000; i++) {
    assert.equal(refs.project(project.name).id, project.id);
    assert.equal(refs.scope(project.id, description).id, scope.id);
    assert.equal(refs.costNode(project.id, "人工费/分项成本").id, child.id);
    assert.equal(refs.costPath(project.id, child.id), "人工费/分项成本");
  }
  assert.deepEqual(calls, { project: 1, scope: 1, cost: 1 });
  assert.throws(() => refs.costNode(project.id, "不存在"), /费用科目完整路径/);
});
