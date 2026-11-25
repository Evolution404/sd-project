import {inspect} from "../inspector.mjs";
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
  assert.equal(s.identity.mustChangePassword(created.id), true);
  const administrator = (await read("/api/users")).items.find(row => row.username === "admin");
  const passwordReset = await fetch(base + "/api/users/" + administrator.id, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "last-admin-temp-password" },
    body: JSON.stringify({ username: administrator.username, password: "Temporary-password" }),
  });
  assert.equal(passwordReset.status, 409);
  assert.equal(s.identity.mustChangePassword(administrator.id), false);
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
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("the audit permission grants business and security records without granting any write access", async t => {
  const {s,user}=fixture(t);
  s.management.setRolePermissions(user, "auditor", {
    expected_version: s.identity.role("auditor").version, permissions: ["audit.read"],
  });
  s.auth.saveUser(user,{username:"audit-reader",password:"audit-reader-password",role:"viewer",role_codes:["auditor"]});
  s.auth.saveUser(user,{username:"audit-denied",password:"audit-denied-password",role:"viewer"});
  s.management.annotateAudit(user,{message:"授权范围核验"});
  const server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  async function authenticate(username) {
    const response=await fetch(base+"/api/login",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password:username+"-password"}),
    });
    assert.equal(response.status,200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  const auditor=await authenticate("audit-reader");
  const viewer=await authenticate("audit-denied");
  const audit=await fetch(base+"/api/audit?q="+encodeURIComponent("授权范围核验"),{headers:{Cookie:auditor}});
  assert.equal(audit.status,200);
  const [row]=(await audit.json()).items;
  assert.equal(row.action,"note");
  const details=await fetch(base+"/api/audit/"+row.id,{headers:{Cookie:auditor}});
  assert.equal((await details.json()).original.id,row.id);
  const security=await fetch(base+"/api/audit/security?q=audit-reader&page_size=1",{headers:{Cookie:auditor}});
  const page=await security.json();
  assert.equal(security.status,200);
  assert.equal(page.total,1);
  assert.equal(page.items[0].event,"login");
  assert.equal(page.items[0].username,"audit-reader");
  assert.ok(!JSON.stringify(page).includes("audit-reader-password"));
  for (const path of ["/api/dashboard", "/api/demands", "/api/projects", "/api/finance/settlements"]) {
    assert.equal((await fetch(base + path, { headers: { Cookie: auditor } })).status, 403, path);
    assert.equal((await fetch(base + path, { headers: { Cookie: viewer } })).status, 200, path);
  }
  assert.equal((await fetch(base+"/api/audit/security",{headers:{Cookie:viewer}})).status,403);
  assert.equal((await fetch(base+"/api/audit/"+row.id,{headers:{Cookie:viewer}})).status,403);
  assert.equal((await fetch(base+"/api/audit",{
    method:"POST",headers:{Cookie:auditor,"Content-Type":"application/json",Origin:base,
      "Idempotency-Key":"audit-reader-rejected-write"},body:JSON.stringify({message:"禁止写入"}),
  })).status,403);
});
