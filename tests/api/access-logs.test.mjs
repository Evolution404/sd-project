import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { request } from "node:http";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const password = "Schema113-test-password";
async function start(s, options) {
  const server = httpServer(s, options);
  await new Promise(resolve => server.listen(0, "0.0.0.0", resolve));
  return { server, base: "http://127.0.0.1:" + server.address().port,
    stop: () => new Promise(resolve => server.close(resolve)) };
}
async function login(base, username = "admin", secret = password) {
  const response = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: secret }) });
  return { response, headers: { Cookie: response.headers.get("set-cookie")?.split(";")[0] || "" } };
}
function records(dir) {
  return readdirSync(join(dir, "logs")).filter(name => name.endsWith(".jsonl"))
    .flatMap(name => readFileSync(join(dir, "logs", name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
}

test("actual HTTP access logs cover authentication, denials, errors, concurrency and safe export", async t => {
  const { s, user, dir } = fixture(t), app = await start(s);
  t.after(app.stop);
  const { base } = app;
  const signed = await login(base);
  assert.equal(signed.response.status, 200);
  assert.match(signed.response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  await login(base, "admin", "NeverLogThisPassword!");
  assert.equal((await fetch(base + "/api/session")).status, 401);
  s.auth.saveUser(user, { username: "log-viewer", password: "Viewer-secret", role: "viewer" });
  const viewer = await login(base, "log-viewer", "Viewer-secret");
  for (const path of ["/api/access-logs", "/api/access-logs/export", "/api/users"])
    assert.equal((await fetch(base + path, { headers: viewer.headers })).status, 403);
  assert.equal((await fetch(base + "/api/missing", { headers: signed.headers })).status, 404);
  const oldDashboard = s.dashboard;
  s.dashboard = () => { throw new Error("private-error Authorization=NeverLogThisToken"); };
  const failure = await fetch(base + "/api/dashboard", { headers: signed.headers });
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /private-error/);
  s.dashboard = oldDashboard;
  const policy = await fetch(base + "/api/access-policy", { method: "POST", headers: {
    ...signed.headers, "Content-Type": "application/json", "Idempotency-Key": "access-log-conflict" },
    body: JSON.stringify({ expected_version: 99, ip_restriction_enabled: false }) });
  assert.equal(policy.status, 409);
  const responses = await Promise.all(Array.from({ length: 75 }, () => fetch(base + "/api/session?token=NeverLogThisQuery", {
    headers: { ...signed.headers, "X-Forwarded-For": "198.51.100.200", Authorization: "Bearer NeverLogThisAuth" } })));
  const ids = new Set(responses.map(response => response.headers.get("x-request-id")));
  assert.equal(ids.size, 75);
  const all = records(dir);
  assert.equal(all.filter(row => ids.has(row.request_id)).length, 75);
  for (const row of all.filter(row => ids.has(row.request_id))) {
    assert.equal(row.ip, "127.0.0.1"); assert.equal(row.path, "/api/session");
    assert.equal(row.method, "GET"); assert.equal(row.status, 200);
    assert.ok(row.duration_ms >= 0 && row.duration_ms < 30000);
    assert.match(row.time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  }
  for (const outcome of ["登录成功", "登录失败", "未登录访问", "权限不足"]) assert.ok(all.some(row => row.outcome === outcome), outcome);
  const failed = all.find(row => row.request_id === failure.headers.get("x-request-id"));
  assert.equal(failed.error_type, "InternalError"); assert.equal(failed.error_summary, "服务内部错误");
  const queried = await fetch(base + "/api/access-logs?status=403&username=log-viewer&sort=duration_ms&direction=asc&page_size=2", { headers: signed.headers });
  const result = await queried.json();
  assert.equal(result.total, 3); assert.equal(result.items.length, 2);
  assert.ok(result.items[0].duration_ms <= result.items[1].duration_ms);
  assert.equal(result.retention_days, 30);
  const exported = await fetch(base + "/api/access-logs/export?status=500", { headers: signed.headers });
  assert.equal(exported.status, 200);
  const exportedRows = (await exported.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(exportedRows.length, 1); assert.equal(exportedRows[0].status, 500);
  for (const query of ["sort=password", "from=invalid", "status=abc", "page=-1", "filters=%7B%22bad%22%3A%22x%22%7D"])
    assert.equal((await fetch(base + "/api/access-logs?" + query, { headers: signed.headers })).status, 422);
  assert.equal((await fetch(base + "/api/logout", { method: "POST", headers: signed.headers })).status, 200);
  assert.ok(records(dir).some(row => row.outcome === "退出登录"));
  const text = JSON.stringify(records(dir));
  for (const secret of [password, "NeverLogThisPassword!", "NeverLogThisToken", "NeverLogThisQuery", "NeverLogThisAuth", signed.headers.Cookie, "set-cookie", "password_hash"])
    assert.equal(text.includes(secret), false, secret);
  const staticRead = await fetch(base + "/data/logs/" + readdirSync(join(dir, "logs"))[0]);
  assert.doesNotMatch(await staticRead.text(), /"request_id"/);
});

test("actual network IP rejection and login throttling are logged", async t => {
  const { s, dir } = fixture(t), app = await start(s);
  t.after(app.stop);
  const address = Object.values(networkInterfaces()).flat().find(entry => entry && entry.family === "IPv4" && !entry.internal)?.address;
  assert.ok(address, "HTTP IP denial acceptance requires a local network interface");
  const status = await new Promise((resolve, reject) => {
    const req = request(app.base.replace("127.0.0.1", address) + "/api/session", { localAddress: address, headers: { "X-Forwarded-For": "127.0.0.1" } }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    }); req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
  const denied = records(dir).find(row => row.outcome === "IP白名单拒绝");
  assert.equal(denied.ip, address);
  for (let n = 0; n < 10; n++) assert.equal((await login(app.base, "admin", "wrong-password")).response.status, 401);
  assert.equal((await login(app.base)).response.status, 429);
  assert.ok(records(dir).some(row => row.outcome === "登录限流" && row.status === 429));
});

test("HTTP log rotation follows Beijing midnight, size limits, retention and server restart", async t => {
  const { s, dir } = fixture(t);
  let time = new Date("2026-11-12T15:59:59Z");
  const options = { accessLog: { clock: () => time, maxFileBytes: 1024 } };
  const folder = join(dir, "logs"); mkdirSync(folder);
  writeFileSync(join(folder, "access-2026-10-13-000001.jsonl"), "expired\n");
  writeFileSync(join(folder, "access-2026-10-14-000001.jsonl"), "retained\n");
  let app = await start(s, options);
  try {
    for (let n = 0; n < 8; n++) await fetch(app.base + "/api/session");
    assert.equal(readdirSync(folder).some(name => name.includes("2026-10-13")), false);
    assert.equal(readdirSync(folder).some(name => name.includes("2026-10-14")), true);
    const before = readdirSync(folder).filter(name => name.includes("2026-11-12"));
    assert.ok(before.length >= 2);
    for (const name of before) assert.ok(statSync(join(folder, name)).size <= 1024);
    time = new Date("2026-11-12T16:00:00Z");
    await fetch(app.base + "/api/session");
    assert.ok(readdirSync(folder).some(name => name.includes("2026-11-13")));
    // Retention maintenance is hourly and also runs at service startup.
    await app.stop(); app = await start(s, options);
    assert.equal(readdirSync(folder).some(name => name.includes("2026-10-14")), false);
    const old = records(dir).length;
    await fetch(app.base + "/api/session");
    assert.equal(records(dir).length, old + 1);
    assert.ok(records(dir).some(row => row.time === "2026-11-12 23:59:59"));
    assert.ok(records(dir).some(row => row.time === "2026-11-13 00:00:00"));
  } finally { await app.stop(); }
});

test("log IO failure leaves HTTP operational and exposes an administrator diagnostic", async t => {
  const { s, dir } = fixture(t);
  writeFileSync(join(dir, "logs"), "blocked directory");
  const app = await start(s); t.after(app.stop);
  const signed = await login(app.base);
  assert.equal(signed.response.status, 200);
  const response = await fetch(app.base + "/api/access-logs", { headers: signed.headers });
  assert.match((await response.json()).diagnostic, /日志读写失败/);
  rmSync(join(dir, "logs")); mkdirSync(join(dir, "logs"));
  assert.equal((await fetch(app.base + "/api/session", { headers: signed.headers })).status, 200);
  assert.ok(records(dir).length > 0);
});
