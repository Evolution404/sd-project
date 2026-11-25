import { test } from "node:test";
import assert from "node:assert/strict";
import * as nativeIcons from "../../web/node_modules/@element-plus/icons-vue/dist/index.js";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const all = routes => routes.flatMap(group => [...(group.children || []), group]);
const names = routes => new Set(all(routes).map(item => item.name));

test("server-side routes contain only allowlisted components and granted modules", t => {
  const { s, user } = fixture(t);
  const admin=s.management.menuRoutes(user);
  assert.ok(names(admin).has("Users"));
  assert.ok(names(admin).has("System"));
  assert.ok(names(admin).has("Audit"));
  assert.ok(names(admin).has("Access"));
  assert.ok(names(admin).has("Materials"));
  assert.equal(all(admin).find(route => route.name === "ProjectApproval")?.meta.hidden, true);
  assert.equal(all(admin).find(route => route.name === "DemandEditor")?.meta.hidden, true);
  const settlementRoutes = ["SettlementCreate", "SettlementEdit", "SettlementVoid", "SettlementReview"];
  for (const name of settlementRoutes) {
    assert.equal(all(admin).find(route => route.name === name)?.meta.hidden, true);
  }
  const reduced=s.auth.saveUser(user,{ username:"menu-viewer",
    password:"menu-readonly-2026",role:"viewer" });
  const viewer=s.auth.login("menu-viewer","menu-readonly-2026").user;
  const basic=s.management.menuRoutes(viewer);
  assert.ok(names(basic).has("Materials"));
  assert.ok(!names(basic).has("System"));
  assert.ok(!names(basic).has("Audit"));
  assert.ok(!names(basic).has("Access"));
  assert.ok(!names(basic).has("Users"));
  assert.ok(!names(basic).has("ProjectApproval"));
  assert.ok(!names(basic).has("DemandEditor"));
  for (const name of settlementRoutes) assert.ok(!names(basic).has(name));
  for(const route of all(admin)) {
    assert.ok(["Layout","business/DemandAdministration","business/DemandEditor","business/MaterialsAdministration","business/FundingAdministration",
      "business/ProjectsAdministration","business/ProjectApprovalAdministration","business/FinanceAdministration","business/SettlementCompose","business/SettlementReview","business/StandardsAdministration","business/PricingAdministration","business/EquipmentAdministration",
      "business/DictionariesAdministration","system/role/index","business/UserAdministration","business/AuditAdministration","business/AccessAdministration"].includes(route.component));
    assert.ok(route.path && route.meta?.title);
    assert.match(route.meta.icon, /^el-icon-[A-Z][A-Za-z]+$/, "menu icon must be a native Element Plus icon");
    assert.ok(nativeIcons[route.meta.icon.slice("el-icon-".length)], "missing native menu icon " + route.meta.icon);
  }
  assert.equal(reduced.status,"active");
});

test("authorized menu HTTP uses current server session, no anonymous or stale routes", async t => {
  const {s,user}=fixture(t);
  s.auth.saveUser(user,{username:"readonly-nav",password:"readonly-nav-password",role:"viewer"});
  const server=httpServer(s);
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  t.after(()=>new Promise(ok=>server.close(ok)));
  const root="http://127.0.0.1:"+server.address().port;
  const signIn=async(username,password)=>{
    const response=await fetch(root+"/api/login",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const cookie=await signIn("admin","Schema113-test-password");
  let response=await fetch(root+"/api/menus/routes",{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  assert.ok(names(await response.json()).has("Users"));
  const reader=await signIn("readonly-nav","readonly-nav-password");
  response=await fetch(root+"/api/menus/routes",{headers:{Cookie:reader}});
  assert.equal(response.status,200);
  assert.equal(names(await response.json()).has("Users"),false);
  assert.equal((await fetch(root+"/api/menus/routes")).status,401);
  assert.equal((await fetch(root+"/api/menus/unapproved",{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(root+"/api/menus/routes",{method:"POST",headers:{
    Cookie:cookie,"Content-Type":"application/json"
  },body:"{}"})).status,405);
});
