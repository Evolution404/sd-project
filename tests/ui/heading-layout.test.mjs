import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectUiContract } from "../../scripts/ui-contract.mjs";

const inspect = (template) =>
  inspectUiContract(`<template>${template}</template>`, "heading.vue").filter(
    (issue) => issue.rule.startsWith("heading-"),
  );

test("page headings keep all action components in one explicit action group", () => {
  assert.deepEqual(
    inspect(
      '<div class="page-heading"><div><h1>台账</h1></div><div class="page-heading-actions"><ElButton>新增</ElButton><ExchangePanel /></div></div>',
    ),
    [],
  );
  assert.deepEqual(
    inspect(
      '<div class="page-heading"><div><h1>工作台</h1></div><ElTag>113</ElTag></div>',
    ),
    [],
  );
});

test("heading gate rejects the ungrouped third flex item from the button-spacing regression", () => {
  const issues = inspect(
    '<div class="page-heading"><div><h1>台账</h1></div><ElButton>新增</ElButton><ExchangePanel /></div>',
  );
  assert.ok(issues.some((issue) => issue.rule === "heading-sections"));
  assert.ok(issues.some((issue) => issue.rule === "heading-action-group"));
});

test("heading gate also rejects unclassified nested actions and conditional buttons", () => {
  assert.ok(
    inspect(
      '<div class="page-heading"><div><h1>需求</h1></div><div><ExchangePanel /><ElButton v-if="canWrite">新增</ElButton></div></div>',
    ).some((issue) => issue.rule === "heading-action-group"),
  );
});
