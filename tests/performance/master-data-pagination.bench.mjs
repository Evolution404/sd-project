import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fixture } from "../helpers.mjs";
import { materialRepository } from "../../dist/server/database/repositories/materials.js";
import { dictionaryRepository } from "../../dist/server/database/repositories/dictionaries.js";
import { createMaterials } from "../../dist/server/modules/materials/service.js";
import { createDictionaries } from "../../dist/server/modules/dictionaries/service.js";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

test(
  "1,000 materials retain two-query pagination and names at every page size",
  { timeout: 180000 },
  (t) => {
    const { s, user, unit } = fixture(t);
    s.database.transaction(() => {
      for (let index = 0; index < 1000; index++)
        s.materials.save(user, {
          name: "压力物资" + String(index).padStart(4, "0"),
          unit_id: unit.id,
        });
    });
    let reads = 0;
    const counted = new Proxy(s.repo, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args) => {
          if (["query", "get", "where", "find", "list"].includes(key)) reads++;
          return value(...args);
        };
      },
    });
    const materials = createMaterials(
      materialRepository(counted),
      s.dictionaries,
      s.database,
      s.audit,
    );
    const dictionaries = createDictionaries(
      dictionaryRepository(counted),
      s.database,
      s.audit,
    );
    const began = performance.now();
    for (const size of [1, 200]) {
      reads = 0;
      const page = materials.search(
        parseListQuery(
          new URLSearchParams({
            q: "压力物资",
            sort: "name",
            direction: "asc",
            page_size: String(size),
          }),
        ),
      );
      assert.equal(reads, 2);
      assert.equal(page.total, 1000);
      assert.equal(page.items.length, size);
      assert.equal(page.items[0].unit_id_label, "套");
    }
    reads = 0;
    assert.equal(
      dictionaries.search("units", parseListQuery(new URLSearchParams())).items
        .length,
      1,
    );
    assert.equal(reads, 2);
    console.log(
      "MASTER_DATA_SQL_BENCH",
      JSON.stringify({
        materials: 1000,
        queriesPerPage: 2,
        elapsedMs: Math.round(performance.now() - began),
      }),
    );
  },
);
