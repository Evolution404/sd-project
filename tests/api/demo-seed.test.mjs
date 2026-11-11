import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

function root(t) {
  const dir = mkdtempSync(join(tmpdir(), "sd113-demo-seed-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("demo first launch supplies linked business sample records in its own SQLite", t => {
  const dir = root(t);
  const target = join(dir, "demo");
  const result = ensureDemoDatabase(target);
  assert.equal(result.created, true);
  assert.equal(result.voltages, 8);
  assert.equal(result.units, 6); // five original units plus square metres, each with explicit precision
  assert.equal(result.lines, 2);
  assert.equal(result.physicalTowers, 8);
  assert.equal(result.logicalTowers, 8);
  assert.equal(result.spans, 6);
  assert.equal(result.workObjects, 3);
  assert.equal(result.operations, 3);
  assert.equal(result.materials, 4);
  assert.equal(result.priceRules, 4);
  assert.equal(result.demands, 3);
  assert.equal(result.projects, 2);
  assert.equal(result.referenceTotalFen, 22800);
  assert.equal(result.actualCostFen, 27400);
  assert.equal(result.approvedSettlementFen, 10800);
  assert.equal(existsSync(join(dir, "schema113.sqlite")), false,
    "isolated demo must not create or touch the normal runtime SQLite");

  const s = createSystem(target);
  try {
    const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
    assert.equal(user.role, "admin");
    assert.deepEqual(inspect(s).integrity().foreignKeys, []);
    assert.equal(inspect(s).integrity().integrity[0].integrity_check, "ok");
    const projects = s.projects.list();
    const done = projects.find(p => p.name.includes("防鸟装置整治"));
    assert.equal(done.status, "approved");
    assert.equal(s.finance.summary(done.id).reference_total_fen, 22800);
    assert.equal(s.finance.summary(done.id).settlement_fen, 10800);
    assert.equal(s.finance.settlements(done.id).length, 2);
    const demands = s.demands.list();
    assert.equal(demands.filter(d => d.status === "active").length, 2);
    assert.equal(s.catalog.list("prices").length, 4);
    assert.equal(s.catalog.list("materials").length, 4);
  } finally { s.close(); }
});

test("demo initialization is idempotent and retains subsequent user changes", t => {
  const dir = join(root(t), "demo");
  const before = ensureDemoDatabase(dir);
  const s = createSystem(dir);
  let created;
  try {
    const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
    created = s.catalog.save(user, "units", { name: "用户添加的计量单位" });
  } finally { s.close(); }
  const second = ensureDemoDatabase(dir);
  assert.equal(second.created, false);
  assert.equal(second.units, before.units + 1);
  const reopen = createSystem(dir);
  try {
    assert.ok(reopen.catalog.get("units", created.id));
    assert.equal(reopen.catalog.list("prices").length, 4);
    assert.equal(reopen.catalog.list("lines").length, 2);
  } finally { reopen.close(); }
});

test("refuses any nonempty target lacking a demo marker", t => {
  const dir = join(root(t), "demo");
  mkdirSync(dir);
  writeFileSync(join(dir, "unrelated.sqlite"), "existing user data");
  assert.throws(() => ensureDemoDatabase(dir), /已有非演示数据/);
  assert.equal(readFileSync(join(dir, "unrelated.sqlite"), "utf8"), "existing user data");
});

test("refuses a tampered demo marker rather than resetting data", t => {
  const dir = join(root(t), "demo");
  ensureDemoDatabase(dir);
  const manifest = join(dir, "DEMO-DATA.json");
  writeFileSync(manifest, JSON.stringify({ purpose: "local-demo", version: 999 }));
  assert.throws(() => ensureDemoDatabase(dir), /版本与当前程序不匹配/);
  assert.equal(existsSync(join(dir, "schema113.sqlite")), true);
});

test("demo account can log in to the real HTTP app and view equipment & projects", async t => {
  const dir = join(root(t), "demo");
  ensureDemoDatabase(dir);
  const s = createSystem(dir), server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    s.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: DEMO_ACCOUNT, password: DEMO_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  for (const path of ["/api/catalog/lines", "/api/catalog/operations",
    "/api/catalog/prices", "/api/demands", "/api/projects"]) {
    const response = await fetch(base + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, path);
    const content = await response.json();
    assert.ok((content.items ?? content).length >= 2, path);
  }
});

test("older known demo seed is safely archived before rebuilding current Schema, never migrated in place", t => {
  const dir = join(root(t), "demo");
  ensureDemoDatabase(dir);
  const s = createSystem(dir);
  let created;
  try {
    const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
    created = s.catalog.save(user, "units", { name: "旧演示中追加的单位", quantity_precision: 0 });
  } finally { s.close(); }
  const markerPath = join(dir, "DEMO-DATA.json");
  const metadata = JSON.parse(readFileSync(markerPath, "utf8"));
  writeFileSync(markerPath, JSON.stringify({ ...metadata, version: 1, schema_sha256: undefined }));
  const refreshed = ensureDemoDatabase(dir);
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.created, true);
  assert.ok(refreshed.archive.startsWith(join(dirname(dir), "demo-archive-")));
  assert.equal(existsSync(join(refreshed.archive, "schema113.sqlite")), true);
  const archived = createSystem(refreshed.archive);
  try {
    assert.ok(archived.catalog.get("units", created.id));
  } finally { archived.close(); }
  const current = createSystem(dir);
  try {
    assert.equal(current.catalog.list("units").length, 6);
    assert.equal(current.management.accessPolicy(current.auth.login(DEMO_ACCOUNT,DEMO_PASSWORD).user).ip_restriction_enabled, true);
  } finally { current.close(); }
  assert.equal(ensureDemoDatabase(dir).created, false);
});

test("schema fingerprint mismatch safely refreshes managed demo and preserves previous database", t => {
  const dir = join(root(t), "demo");
  ensureDemoDatabase(dir);
  const markerPath = join(dir, "DEMO-DATA.json");
  const metadata = JSON.parse(readFileSync(markerPath, "utf8"));
  writeFileSync(markerPath, JSON.stringify({ ...metadata, schema_sha256: "old-authority" }));
  const refreshed = ensureDemoDatabase(dir);
  assert.equal(refreshed.refreshed, true);
  assert.equal(existsSync(join(refreshed.archive, "schema113.sqlite")), true);
  assert.equal(ensureDemoDatabase(dir).created, false);
});
