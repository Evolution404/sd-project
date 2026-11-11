import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("bounded statement LRU evicts old shapes while deletion reads observe commit and rollback", (t) => {
  const { s, user, towers } = fixture(t);
  const db = s.database.connection,
    original = db.prepare;
  let compiled = 0;
  db.prepare = function (sql) {
    compiled++;
    return original.call(this, sql);
  };
  try {
    for (let i = 0; i < 300; i++)
      assert.equal(
        inspect(s).get(`SELECT ? AS value /* cache-${i} */`, i).value,
        i,
      );
    const before = compiled;
    assert.equal(inspect(s).get("SELECT ? AS value /* cache-299 */", 7).value, 7);
    assert.equal(compiled, before);
    inspect(s).get("SELECT ? AS value /* cache-0 */", 8);
    assert.equal(compiled, before + 1);
  } finally {
    db.prepare = original;
  }
  assert.equal(inspect(s).isDeleted("physical", towers[0].id), false);
  assert.throws(
    () =>
      inspect(s).transaction(() => {
        s.catalog.remove(user, "physical", towers[0].id, 1);
        assert.equal(inspect(s).isDeleted("physical", towers[0].id), true);
        throw Error("rollback-sentinel");
      }),
    /rollback-sentinel/,
  );
  assert.equal(inspect(s).isDeleted("physical", towers[0].id), false);
  s.catalog.remove(user, "physical", towers[0].id, 1);
  assert.equal(inspect(s).isDeleted("physical", towers[0].id), true);
});

test("duplicate probes use unique multi-position current definitions and ignore cancelled demand history", (t) => {
  const { s, user, operation, towers, demandInput } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  const loc = (id) => ({ physical_tower_id: id });
  assert.equal(
    inspect(s).demandDuplicates(operation.id, [
      loc(towers[0].id),
      loc(towers[0].id),
      loc(towers[1].id),
    ]).length,
    1,
  );
  s.demands.save(
    user,
    {
      ...demand,
      expected_version: 1,
      work_locations: demand.work_locations.slice(1),
    },
    demand.id,
  );
  assert.equal(
    inspect(s).demandDuplicates(operation.id, [loc(towers[0].id)]).length,
    0,
  );
  assert.equal(
    inspect(s).demandDuplicates(operation.id, [loc(towers[1].id)]).length,
    1,
  );
  assert.equal(
    inspect(s).demandDuplicates(operation.id, [loc(towers[1].id)], demand.id)
      .length,
    0,
  );
  s.demands.transition(user, demand.id, {
    expected_version: 2,
    expected_event_seq: 1,
    status: "cancelled",
  });
  assert.equal(
    inspect(s).demandDuplicates(operation.id, [loc(towers[1].id)]).length,
    0,
  );
});
