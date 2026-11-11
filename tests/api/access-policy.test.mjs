import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { createSystem } from "../../dist/server/bootstrap.js";
import { inspect } from "../inspector.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

test("IP restriction setting persists and controls allowed addresses", t => {
  const { s, user, dir } = fixture(t);
  const initial = s.management.accessPolicy(user);
  assert.equal(initial.version, 1);
  assert.equal(initial.ip_restriction_enabled, true);
  assert.equal(s.auth.permittedIp("192.0.2.10"), false);
  assert.equal(s.auth.permittedIp("127.0.0.1"), true);
  assert.equal(s.auth.permittedIp("::ffff:127.0.0.1"), true);
  s.management.saveIp(user, { ip: "192.0.2.20", note: "已授权" });
  assert.equal(s.auth.permittedIp("192.0.2.20"), true);
  const disabled = s.management.setAccessPolicy(user, {
    ip_restriction_enabled: false, expected_version: 1,
  });
  assert.equal(disabled.version, 2);
  assert.equal(disabled.ip_restriction_enabled, false);
  for (const address of ["192.0.2.10", "2001:db8::3", "198.51.100.9"])
    assert.equal(s.auth.permittedIp(address), true);
  const reopened = createSystem(dir);
  try {
    assert.equal(reopened.management.accessPolicy(user).ip_restriction_enabled, false);
    assert.equal(reopened.auth.permittedIp("198.51.100.9"), true);
  } finally {
    reopened.close();
  }
  const enabled = s.management.setAccessPolicy(user, {
    ip_restriction_enabled: true, expected_version: 2,
  });
  assert.equal(enabled.version, 3);
  assert.equal(s.auth.permittedIp("192.0.2.10"), false);
  assert.equal(s.auth.permittedIp("192.0.2.20"), true);
  assert.equal(s.auth.permittedIp("::1"), true);
  const history = s.management.audits(user).filter(row =>
    row.entity === "access_policy" && row.entity_id === "ip_restriction");
  assert.equal(history.length, 2);
  assert.ok(history.every(row => row.actor_id === user.id));
  assert.deepEqual(inspect(s).integrity().foreignKeys, []);
});

test("only administrator changes access policy, stale and invalid writes do not persist", t => {
  const { s, user } = fixture(t);
  const account = s.auth.saveUser(user, {
    username: "readonly-policy", role: "viewer", password: "Readonly-Password",
  });
  const viewer = s.auth.login(account.username, "Readonly-Password").user;
  assert.throws(() => s.management.accessPolicy(viewer), /权限/);
  assert.throws(() => s.management.setAccessPolicy(viewer, {
    ip_restriction_enabled: false, expected_version: 1,
  }), /权限/);
  assert.throws(() => s.management.setAccessPolicy(user, {
    ip_restriction_enabled: 0, expected_version: 1,
  }), /开关/);
  assert.throws(() => s.management.setAccessPolicy(user, {
    ip_restriction_enabled: false,
  }), /版本/);
  assert.throws(() => s.database.transaction(() => {
    s.management.setAccessPolicy(user, {
      ip_restriction_enabled: false, expected_version: 1,
    });
    throw Error("transaction-rollback");
  }), /transaction-rollback/);
  assert.equal(s.management.accessPolicy(user).version, 1);
  assert.equal(s.auth.permittedIp("198.51.100.7"), false);
  assert.equal(s.management.audits(user).filter(row => row.entity === "access_policy").length, 0);
  s.management.setAccessPolicy(user, {
    ip_restriction_enabled: false, expected_version: 1,
  });
  assert.throws(() => s.management.setAccessPolicy(user, {
    ip_restriction_enabled: true, expected_version: 1,
  }), /已被其他管理员修改/);
  assert.throws(() => s.management.setAccessPolicy(user, {
    ip_restriction_enabled: false, expected_version: 2,
  }), /没有变化/);
  assert.equal(s.management.accessPolicy(user).version, 2);
});

test("IP policy HTTP endpoint validates identity, version and idempotency", async t => {
  const {s,user}=fixture(t), server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  assert.equal((await fetch(base+"/api/access-policy")).status,401);
  const login=await fetch(base+"/api/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"admin",password:"Schema113-test-password"}),
  });
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const headers={Cookie:cookie,"Content-Type":"application/json"};
  const original=await fetch(base+"/api/access-policy",{headers});
  assert.equal(original.status,200);
  assert.equal((await original.json()).ip_restriction_enabled,true);
  assert.equal((await fetch(base+"/api/access-policy", {
    method:"DELETE",headers,body:"{}",
  })).status,405);
  const account=s.auth.saveUser(user,{
    username:"policy-viewer-http",role:"viewer",password:"Viewer-Http-Password",
  });
  const viewer=s.auth.login(account.username,"Viewer-Http-Password").token;
  assert.equal((await fetch(base+"/api/access-policy",{
    headers:{...headers,Cookie:"sd113="+viewer},
  })).status,403);
  const payload=JSON.stringify({ip_restriction_enabled:false,expected_version:1});
  const mutationHeaders={...headers,"Idempotency-Key":"change-ip-restriction-off"};
  const changed=await fetch(base+"/api/access-policy",{
    method:"POST",headers:mutationHeaders,body:payload,
  });
  assert.equal(changed.status,200,await changed.clone().text());
  assert.equal((await changed.json()).version,2);
  const replay=await fetch(base+"/api/access-policy",{
    method:"POST",headers:mutationHeaders,body:payload,
  });
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).version,2);
  assert.equal(s.management.accessPolicy(user).version,2);
  const stale=await fetch(base+"/api/access-policy",{
    method:"POST",headers:{...headers,"Idempotency-Key":"stale-ip-restriction"},
    body:JSON.stringify({ip_restriction_enabled:true,expected_version:1}),
  });
  assert.equal(stale.status,409);
  assert.equal(s.management.accessPolicy(user).ip_restriction_enabled,false);
  assert.equal((await fetch(base+"/api/session",{headers})).status,200);
});
