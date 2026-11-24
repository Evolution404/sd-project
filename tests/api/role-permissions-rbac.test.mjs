import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { authorize } from "../../dist/server/platform/auth/service.js";

test("editable admin grants: revoke one permission, no ROOT bypass, protect last admin", t=>{
  const {s,user:admin}=fixture(t);
  const initial=s.management.role(admin,"admin");
  const defined=s.management.permissions(admin).definitions.map(p=>p.code);
  assert.deepEqual(new Set(initial.permissions),new Set(defined),"administrator initially receives every defined permission");
  const old=s.auth.login("admin","Schema113-test-password");
  const reduced=initial.permissions.filter(code=>code!=="project.approve");
  const changed=s.management.setRolePermissions(admin,"admin",{
    expected_version:initial.version,permissions:reduced,
  });
  assert.equal(changed.version,initial.version+1);
  assert.equal(changed.permissions.includes("project.approve"),false);
  assert.throws(()=>s.auth.actor(old.token),/请登录/,"grant changes must immediately revoke sessions");
  const newAdmin=s.auth.login("admin","Schema113-test-password").user;
  assert.ok(newAdmin.permissions.includes("admin"));
  assert.ok(newAdmin.permissions.includes("role.manage"));
  assert.equal(newAdmin.permissions.includes("project.approve"),false);
  assert.throws(()=>authorize(newAdmin,"project.approve"),/权限/);
  assert.doesNotThrow(()=>authorize(newAdmin,"cost.confirm"));
  assert.throws(()=>s.management.setRolePermissions(newAdmin,"admin",{
    expected_version:initial.version,permissions:initial.permissions
  }),/版本/);
  for (const critical of ["role.manage","user.manage"]) {
    assert.throws(()=>s.management.setRolePermissions(newAdmin,"admin",{
      expected_version:changed.version,permissions:reduced.filter(code=>code!==critical)
    }),/必须保留一个有效管理员/,
    "revoking the last recovery capability must fail: "+critical);
    assert.ok(s.management.role(newAdmin,"admin").permissions.includes(critical),
      "rejected removal must roll back atomically");
  }
  assert.ok(s.management.audits(newAdmin).some(event=>event.entity==="roles"&&event.action==="permission_grant"));
  // Generic legacy admin rights are editable; only recovery-capable user
  // and role management rights must remain on at least one active account.
  const removedLegacyAdmin=s.management.setRolePermissions(newAdmin,"admin",{
    expected_version:changed.version,permissions:reduced.filter(code=>code!=="admin"),
  });
  assert.equal(removedLegacyAdmin.permissions.includes("admin"),false);
  const recovered=s.auth.login("admin","Schema113-test-password").user;
  assert.ok(recovered.permissions.includes("user.manage"));
  assert.ok(recovered.permissions.includes("role.manage"));
  assert.doesNotThrow(()=>s.management.roles(recovered));
});

test("multiple active roles union actions; custom role is not a privilege bypass",t=>{
  const {s,user:admin}=fixture(t);
  const user=s.management.saveUser(admin,{
    username:"multi-role",password:"secret-for-test",role:"viewer",
    role_codes:["viewer","editor","verifier"],display_name:"多角色用户"
  });
  assert.equal(s.identity.rolesForUser(user.id).length,3);
  const login=s.auth.login("multi-role","secret-for-test");
  assert.equal(login.user.role,"viewer","legacy primary role is not the security authority");
  assert.ok(login.user.permissions.includes("write"));
  assert.ok(login.user.permissions.includes("settlement.approve"));
  assert.ok(!login.user.permissions.includes("admin"));
  assert.throws(()=>authorize(login.user,"admin"),/管理员权限/);
  assert.throws(()=>s.management.saveRole(login.user,{code:"exploit",name:"绕权"}),/权限/);
  const created=s.management.saveRole(admin,{
    code:"field_team",name:"现场作业组",sort_order:80,auto_grant_new_permissions:false
  });
  assert.deepEqual(created.permissions,[]);
  const updated=s.management.setRolePermissions(admin,"field_team",{
    expected_version:created.version,permissions:["read","write"],
  });
  assert.deepEqual(updated.permissions,["read","write"]);
  s.management.saveUser(admin,{
    username:"multi-role",role:"viewer",role_codes:["field_team"]
  },user.id);
  assert.throws(()=>s.auth.actor(login.token),/请登录/);
  const userAfter=s.auth.login("multi-role","secret-for-test").user;
  assert.equal(userAfter.permissions.includes("settlement.approve"),false);
  assert.ok(userAfter.permissions.includes("write"));
  const before=s.management.roles(admin).find(x=>x.code==="field_team");
  assert.throws(()=>s.management.saveRole(admin,{
    name:"现场作业组2",expected_version:before.version-1
  },"field_team"),/版本/);
  assert.throws(()=>s.management.setRolePermissions(admin,"field_team",{
    expected_version:before.version,permissions:["*:*:*"]
  }),/未经服务端注册/);
  assert.equal(s.management.roles(admin).find(x=>x.code==="field_team").version,before.version);
});

test("role management HTTP routes enforce permissions, version and idempotency",async t=>{
  const {s,user:admin}=fixture(t);
  const server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  const login=await fetch(base+"/api/login",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"admin",password:"Schema113-test-password"})
  });
  assert.equal(login.status,200);
  let cookie=login.headers.get("set-cookie").split(";")[0];
  const read=async path=>{
    const resp=await fetch(base+path,{headers:{Cookie:cookie}});
    return {status:resp.status,body:await resp.json()};
  };
  const write=async(method,path,data,idempotency)=> {
    const resp=await fetch(base+path,{method,headers:{
      Cookie:cookie,"Content-Type":"application/json","Idempotency-Key":idempotency,
    },body:JSON.stringify(data)});
    return {status:resp.status,body:await resp.json()};
  };
  const list=await read("/api/roles");
  assert.equal(list.status,200);
  assert.ok(list.body.items.some(role=>role.code==="admin"));
  const custom=await write("POST","/api/roles",{
    code:"line_operator",name:"输电巡视",sort_order:55
  },"role-create-123");
  assert.equal(custom.status,200);
  assert.equal(custom.body.version,1);
  const newGrant=await write("PUT","/api/roles/line_operator/permissions",{
    expected_version:1,permissions:["read","write"]
  },"role-grant-123");
  assert.equal(newGrant.status,200);
  assert.equal(newGrant.body.version,2);
  const stale=await write("PUT","/api/roles/line_operator/permissions",{
    expected_version:1,permissions:["read"]
  },"role-grant-stale-123");
  assert.equal(stale.status,409);
  const noAuth=await fetch(base+"/api/roles");
  assert.equal(noAuth.status,401);
  s.auth.saveUser(admin,{username:"role-viewer",password:"test123",role:"viewer"});
  const viewer=await fetch(base+"/api/login",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"role-viewer",password:"test123"})
  });
  const viewerCookie=viewer.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(base+"/api/roles",{headers:{Cookie:viewerCookie}})).status,403);
  assert.equal((await read("/api/roles/line_operator")).body.permissions.length,2);
});
