import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { approvedFixture } from "../helpers.mjs";
import { hierarchyRepository } from "../../dist/server/database/repositories/hierarchies.js";

test(
  "500 cost categories and 500 organizations use fixed query counts",
  { timeout: 180000 },
  (t) => {
    const { s, user, project, node, save } = approvedFixture(t);
    const root = save("organizations", { name: "性能根单位" });
    let calls = 0;
    const counted = new Proxy(s.repo, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args) => {
          if (["query", "get", "where", "find", "list"].includes(key)) calls++;
          return value(...args);
        };
      },
    });
    const repository = hierarchyRepository(counted);
    const observed = [];
    for (const size of [10, 500]) {
      s.repo.transaction(() => {
        for (let index = size === 10 ? 1 : 10; index < size; index++) {
          s.finance.node(user, project.id, {
            name: "性能科目" + index,
            parent_id: node.id,
          });
          save("organizations", {
            name: "性能单位" + index,
            parent_unit_id: root.id,
          });
        }
      });
      const started = performance.now();
      calls = 0;
      const costs = repository.costTree(project.id);
      assert.equal(costs.length, size);
      assert.equal(calls, 1);
      calls = 0;
      assert.equal(repository.organizations().length, size);
      assert.equal(calls, 1);
      calls = 0;
      repository.categoryDetail(project.id, node.id);
      assert.equal(calls, 4);
      calls = 0;
      repository.organizationDetail(root.id);
      assert.equal(calls, 4);
      assert.equal(
        costs.find((item) => item.id === node.id).leaf_count,
        size - 1,
      );
      observed.push({
        nodesPerTree: size,
        queriesPerTree: 1,
        queriesPerDetail: 4,
        elapsedMs: Math.round(performance.now() - started),
      });
    }
    assert.deepEqual(s.repo.integrity().foreignKeys, []);
    console.log("HIERARCHY_BENCH", JSON.stringify(observed));
  },
);
