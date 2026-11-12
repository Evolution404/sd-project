import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fixture } from "../helpers.mjs";
import { pricingRepository } from "../../dist/server/database/repositories/pricing.js";
import { priceRuleRepository } from "../../dist/server/database/repositories/price-rules.js";
import { workStandardRepository } from "../../dist/server/database/repositories/work-standards.js";
import { createPricing } from "../../dist/server/modules/pricing/service.js";
import { createPriceRules } from "../../dist/server/modules/pricing/rules.js";
import { createWorkStandards } from "../../dist/server/modules/work-standards/service.js";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

test("100-location pricing has a fixed four reads and approval summary has two targeted reads", (t) => {
  const { s, user, save, operation, demandInput } = fixture(t);
  const towers = s.database.transaction(() =>
    Array.from({ length: 100 }, (_, index) =>
      save("physical", { asset_no: "计价压力" + index }),
    ),
  );
  const demand = s.demands.save(user, {
    ...demandInput,
    work_locations: towers.map((tower) => ({
      location_kind: "physical_tower",
      physical_tower_id: tower.id,
      quantity_scaled: 10000,
    })),
  });
  let reads = 0;
  const store = new Proxy(inspect(s), {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (["query", "get", "where", "find", "list"].includes(key)) reads++;
        return value(...args);
      };
    },
  });
  const standardRepository = workStandardRepository(store),
    ruleRepository = priceRuleRepository(store);
  const standards = createWorkStandards(
    standardRepository,
    s.dictionaries,
    s.database,
    s.audit,
  );
  const rules = createPriceRules(
    ruleRepository,
    standards,
    s.equipment,
    s.database,
    s.audit,
  );
  const pricing = createPricing(
    pricingRepository(store),
    rules,
    standards,
    s.database,
    s.audit,
  );
  const began = performance.now();
  const quote = pricing.quote(user, demand.id, { expected_version: 1 });
  assert.equal(quote.complete, true);
  assert.equal(quote.lines.length, 100);
  assert.equal(reads, 4);
  reads = 0;
  const summary = pricing.summary("no-such-approval");
  assert.equal(reads, 2);
  assert.equal(summary.total_fen, null);
  for (const size of [1, 200]) {
    reads = 0;
    assert.ok(
      standards
        .searchOperations(
          parseListQuery(new URLSearchParams({ page_size: String(size) })),
        )
        .items.some((item) => item.id === operation.id),
    );
    assert.equal(reads, 2);
    reads = 0;
    assert.ok(
      rules.search(
        parseListQuery(new URLSearchParams({ page_size: String(size) })),
      ).total > 0,
    );
    assert.equal(reads, 2);
  }
  console.log(
    "PRICING_SQL_BENCH",
    JSON.stringify({
      locations: 100,
      quoteReads: 4,
      summaryReads: 2,
      listReads: 2,
      elapsedMs: Math.round(performance.now() - began),
    }),
  );
});
