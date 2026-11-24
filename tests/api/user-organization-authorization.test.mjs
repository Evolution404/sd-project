import test from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../helpers.mjs";

test("user affiliations reference existing formal organization identities and use versions",t=>{
  const {s,user:admin,save}=fixture(t);
  const dept=save("organizations",{name:"输电运检中心"});
  const team=save("organizations",{name:"运检班组",parent_unit_id:dept.id});
  const newUser=s.management.saveUser(admin,{
    username:"org-user",password:"org-password",
    display_name:"组织关联人员",role:"viewer",role_codes:["viewer"],
    primary_org_id:dept.id,organization_ids:[dept.id,team.id],
  });
  assert.deepEqual(s.identity.organizationsForUser(newUser.id),[dept.id,team.id]);
  assert.equal(s.identity.user(newUser.id).primary_org_id,dept.id);
  assert.equal(newUser.version,1);
  const changed=s.management.saveUser(admin,{
    username:"org-user",display_name:"班组人员",
    primary_org_id:team.id,organization_ids:[dept.id,team.id],
    role_codes:["viewer"],expected_version:1,
  },newUser.id);
  assert.equal(changed.version,2);
  assert.equal(changed.primary_org_id,team.id);
  assert.deepEqual(s.identity.organizationsForUser(newUser.id),[team.id,dept.id]);
  assert.throws(()=>s.management.saveUser(admin,{
    username:"org-user",display_name:"被覆盖的名称",
    expected_version:1,
  },newUser.id),/用户版本已变化/);
  assert.equal(s.identity.user(newUser.id).display_name,"班组人员");
  assert.throws(()=>s.management.saveUser(admin,{
    username:"org-user",primary_org_id:"missing-organization",role_codes:["viewer"],
    expected_version:2,
  },newUser.id),/组织不存在/);
  assert.deepEqual(s.identity.organizationsForUser(newUser.id),[team.id,dept.id]);
  assert.equal(s.catalog.get("organizations",dept.id).name,"输电运检中心",
    "editing an account must not mutate formal organization identity");
});

test("user.manage alone cannot assign admin role, take over role manager or reset privileged password",t=>{
  const {s,user:admin}=fixture(t);
  const role=s.management.saveRole(admin,{code:"account_editor",name:"账号资料维护"});
  s.management.setRolePermissions(admin,"account_editor",{
    expected_version:role.version,permissions:["read","user.manage"],
  });
  const manager=s.management.saveUser(admin,{
    username:"account-operator",password:"account-password",role:"viewer",
    role_codes:["viewer","account_editor"],
  });
  const user=s.auth.login("account-operator","account-password").user;
  assert.ok(user.permissions.includes("user.manage"));
  assert.ok(!user.permissions.includes("role.manage"));
  const created=s.management.saveUser(user,{
    username:"no-elevate",password:"password",role:"viewer",role_codes:["viewer"],
  });
  assert.ok(created.id);
  assert.throws(()=>s.management.saveUser(user,{
    username:"new-admin",password:"password",role:"admin",role_codes:["admin"],
  }),/无此操作权限/);
  assert.throws(()=>s.management.saveUser(user,{
    username:"admin",password:"stolen-password",role_codes:["admin"],
  },admin.id),/无此操作权限/);
  assert.equal(s.auth.login("admin","Schema113-test-password").user.role,"admin");
  assert.equal(s.identity.user(manager.id).status,"active");
});
