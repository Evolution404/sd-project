import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTree,
  treePath,
  matchingTreeIds,
  descendantIds,
} from "../../tests/fixtures/legacy-frontend/web/src/shared/utils/tree.ts";
const records = [
  { id: "c", parent_id: "b", name: "中心" },
  { id: "other", parent_id: null, name: "其他根" },
  { id: "a", parent_id: null, name: "公司" },
  { id: "b", parent_id: "a", name: "部门" },
  { id: "same", parent_id: "other", name: "中心" },
];
test("tree handles empty, single and unordered multiple-root hierarchies without mutating facts", () => {
  assert.deepEqual(buildTree([]), []);
  assert.equal(buildTree([records[2]])[0].children.length, 0);
  const before = JSON.stringify(records),
    tree = buildTree(records);
  assert.equal(tree.length, 2);
  assert.equal(
    tree.find((node) => node.id === "a").children[0].children[0].id,
    "c",
  );
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(buildTree([...records].reverse()), tree);
  assert.deepEqual(
    treePath(records, "c").map((node) => node.id),
    ["a", "b", "c"],
  );
  assert.deepEqual([...descendantIds(records, "a")].sort(), ["b", "c"]);
});
test("search includes every matching identity and its ancestors, preserving same-name branches", () => {
  assert.deepEqual([...matchingTreeIds(records, "中心")].sort(), [
    "a",
    "b",
    "c",
    "other",
    "same",
  ]);
  assert.equal(matchingTreeIds(records, "不存在").size, 0);
  assert.equal(matchingTreeIds(records, "").size, records.length);
});
test("orphan and cyclic historical nodes remain safely visible", () => {
  const rows = [
    { id: "a", parent_id: "b", name: "甲" },
    { id: "b", parent_id: "a", name: "乙" },
    { id: "c", parent_id: "missing", name: "丙" },
  ];
  const tree = buildTree(rows);
  assert.equal(tree.length, 3);
  assert.equal(tree.filter((node) => node.issue === "cycle").length, 2);
  assert.equal(tree.find((node) => node.id === "c").issue, "orphan");
  assert.equal(treePath(rows, "a").length, 2);
  assert.equal(descendantIds(rows, "a").size, 1);
  assert.equal(matchingTreeIds(rows, "甲").size, 2);
  assert.throws(() => buildTree([rows[0], rows[0]]), /身份重复/);
});
test("large trees build iteratively and state keys remain stable after a name change", () => {
  const rows = Array.from({ length: 5000 }, (_, index) => ({
    id: String(index),
    parent_id: index ? String(index - 1) : null,
    name: "节点" + index,
  }));
  assert.equal(buildTree(rows)[0].id, "0");
  assert.equal(matchingTreeIds(rows, "节点4999").size, 5000);
  assert.equal(treePath(rows, "4999").length, 5000);
  rows[100].name = "更新名称";
  assert.equal(treePath(rows, "4999")[100].id, "100");
});
