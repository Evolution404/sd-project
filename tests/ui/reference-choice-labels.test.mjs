import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceLabels } from "../../tests/fixtures/legacy-frontend/web/src/shared/utils/choice-labels.ts";

test("identifiers remain option values and equivalent names receive necessary business context", () => {
  const labels = choiceLabels([
    { id: "technical-key-a", name: "常规检修", year: 2026 },
    { id: "technical-key-b", name: "专项治理", year: 2026 },
    { id: "technical-key-c", name: "专项治理", year: 2027 },
  ], item => item.name, item => [item.year]);
  assert.equal(labels.get("technical-key-a"), "常规检修");
  assert.equal(labels.get("technical-key-b"), "专项治理 · 2026");
  assert.equal(labels.get("technical-key-c"), "专项治理 · 2027");
  assert.ok([...labels.values()].every(label => !label.includes("technical-key")));
});
