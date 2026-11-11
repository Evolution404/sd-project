import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

test("system management API delegates authenticated users, IP, audit and permission workflows", async (t) => {
  const { s } = fixture(t);
  const server = httpServer(s);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const denied = await fetch(base + "/api/users");
  assert.equal(denied.status, 401);
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Schema113-test-password" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const read = async (path) => {
    const response = await fetch(base + path, { headers });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  let counter = 0;
  const mutate = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...headers, "Idempotency-Key": "management-" + (++counter) + "-request" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, method + " " + path + ": " + await response.clone().text());
    return response.json();
  };
  const permissions = await read("/api/permissions");
  assert.ok(permissions.definitions.length);
  assert.ok(permissions.grants.length);

  await mutate("POST", "/api/ips", { ip: "192.0.2.20", note: "文档专用地址" });
  const ips = await read("/api/ips");
  const ip = ips.items.find((row) => row.ip === "192.0.2.20");
  assert.ok(ip);
  await mutate("DELETE", "/api/ips/" + ip.id, {});
  assert.ok(!(await read("/api/ips")).items.some((row) => row.id === ip.id));

  const created = await mutate("POST", "/api/users", {
    username: "management-test-viewer",
    password: "Management-test-password",
    role: "viewer",
  });
  assert.ok((await read("/api/users")).items.some((row) => row.id === created.id));
  await mutate("DELETE", "/api/users/" + created.id, {});
  assert.ok(!(await read("/api/users")).items.some((row) => row.id === created.id));
  await mutate("POST", "/api/audit", { message: "管理员手动审计备注" });
  const audit = await read("/api/audit");
  assert.ok(audit.items.some((row) => row.entity === "manual" && row.action === "note"));
});

test("management revisions protect last administrator and preserve corrected audit history", (t) => {
  const { s, user } = fixture(t);
  const own = s.management.users(user).find(row => row.id === user.id);
  assert.equal(own.role, "admin");
  assert.throws(() => s.management.saveUser(user, {}, own.id, "DELETE"), /必须保留一个有效管理员/);
  assert.equal(s.management.users(user).find(row => row.id === own.id).status, "active");
  assert.equal(s.management.audits(user).some(row => row.entity === "users" &&
    row.entity_id === own.id && row.action === "delete"), false);

  const created = s.management.saveUser(user, {
    username: "历史审计核验", password: "test-credential",
    role: "viewer", status: "active",
  });
  const history = s.management.audits(user);
  const creation = history.find(row => row.entity === "users" &&
    row.entity_id === created.id && row.action === "create");
  assert.ok(creation);
  assert.equal(creation.actor_username, user.username);
  assert.equal(creation.after_json.includes("test-credential"), false);

  s.management.annotateAudit(user, { message: "核对说明" }, creation.id, "POST");
  assert.equal(s.management.audits(user, false, creation.id).decisions[0].action, "correct");
  s.management.annotateAudit(user, {}, creation.id, "DELETE");
  assert.equal(s.management.audits(user).some(row => row.id === creation.id), false);
  assert.equal(s.management.audits(user, true).some(row => row.id === creation.id), true);
  assert.equal(s.management.audits(user, false, creation.id).decisions.length, 2);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
