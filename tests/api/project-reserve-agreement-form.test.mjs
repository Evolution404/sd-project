import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";

function base(t) {
  const f = fixture(t);
  const {s,user,save} = f;
  const f1 = save("frameworks", {name:"框架甲",fiscal_year:2026,limit_fen:1000000});
  const f2 = save("frameworks", {name:"框架乙",fiscal_year:2027,limit_fen:3000000});
  const a1 = save("agreements", {name:"甲框架协议",framework_id:f1.id,limit_fen:200000});
  const a2 = save("agreements", {name:"乙框架协议",framework_id:f2.id,limit_fen:300000});
  return {...f,f1,f2,a1,a2};
}

test("new project can omit execution agreement, select it in the same save, and retain auditable profile snapshots",t => {
  const {s,user,f1,a1}=base(t);
  const plain=s.projects.save(user,{name:"不关联执行协议的储备项目",framework_id:f1.id,agreement_id:null});
  assert.equal(plain.status,"reserve");
  assert.equal(plain.framework_id,f1.id);
  assert.equal(plain.funding,null);
  // The framework owns the direct project in exactly the same budget and
  // reporting projection; an agreement is not a prerequisite or backlog.
  const frameworkDetails=s.funding.details("frameworks",f1.id);
  assert.ok(frameworkDetails.projects.some(p=>p.id===plain.id && p.agreement_id===null));
  assert.equal(frameworkDetails.summary.project_count,1);
  const assigned=s.projects.save(user,{name:"创建时选定执行协议的储备项目",framework_id:f1.id,agreement_id:a1.id});
  assert.equal(assigned.funding.agreement_id,a1.id);
  assert.equal(assigned.funding.version_no,1);
  const profiles=inspect(s).where("project_management_versions",{project_id:assigned.id});
  assert.equal(profiles.length,1);
  assert.equal(profiles[0].framework_id,f1.id);
  assert.equal(inspect(s).where("project_funding_versions",{project_id:assigned.id}).length,1);
});

test("reserve-stage project framework and agreement change atomically with immutable history and correct latest ownership",t => {
  const {s,user,f1,f2,a1,a2}=base(t);
  const first=s.projects.save(user,{name:"储备项目",framework_id:f1.id,agreement_id:a1.id});
  const changed=s.projects.save(user,{
    name:"储备项目修订", framework_id:f2.id, agreement_id:a2.id,
    expected_version:first.profile_version,
    expected_funding_version:first.funding.version_no,
  },first.id);
  assert.equal(changed.framework_id,f2.id);
  assert.equal(changed.funding.agreement_id,a2.id);
  assert.equal(changed.funding.version_no,3);
  assert.equal(changed.profile_version,2);
  const profiles=inspect(s).where("project_management_versions",{project_id:first.id})
    .sort((a,b)=>a.version_no-b.version_no);
  assert.deepEqual(profiles.map(p=>p.framework_id),[f1.id,f2.id]);
  const history=inspect(s).where("project_funding_versions",{project_id:first.id})
    .sort((a,b)=>a.version_no-b.version_no);
  assert.deepEqual(history.map(v=>v.agreement_id),[a1.id,null,a2.id]);
  assert.equal(s.projects.get(first.id).framework_id,f2.id);
  const unchanged=s.projects.save(user,{
    name:"仅更新责任说明",framework_id:f2.id,agreement_id:a2.id,
    expected_version:changed.profile_version,
    expected_funding_version:changed.funding.version_no,
  },first.id);
  assert.equal(unchanged.funding.version_no,3,"unchanged agreement must not append redundant funding events");
});

test("changing framework to a valid unassigned reserve project keeps agreement empty and prevents cross-framework and stale writes",t => {
  const {s,user,f1,f2,a1,a2}=base(t);
  const first=s.projects.save(user,{name:"可变更项目",framework_id:f1.id,agreement_id:a1.id});
  assert.throws(()=>s.projects.save(user,{
    name:"非法跨框架关联",framework_id:f2.id,agreement_id:a1.id,
    expected_version:first.profile_version,expected_funding_version:1,
  },first.id),/执行协议必须属于本项目所选年度框架/);
  assert.equal(s.projects.get(first.id).framework_id,f1.id,"failed change must be rolled back");
  assert.equal(s.projects.get(first.id).funding.agreement_id,a1.id);
  const directDefault=s.projects.save(user,{
    name:"自动转为年度框架直归",framework_id:f1.id,agreement_id:a1.id,
  });
  const directChanged=s.projects.save(user,{
    name:"跨框架后直接归属框架",framework_id:f2.id,
    expected_version:1,expected_funding_version:1,
  },directDefault.id);
  assert.equal(directChanged.framework_id,f2.id);
  assert.equal(directChanged.funding.agreement_id,null);
  const detached=s.projects.save(user,{
    name:"当前无协议",framework_id:f2.id,agreement_id:null,
    expected_version:1,expected_funding_version:1,
  },first.id);
  assert.equal(detached.funding.agreement_id,null);
  assert.equal(detached.funding.version_no,2);
  assert.throws(()=>s.projects.save(user,{
    name:"旧版本提交",framework_id:f2.id,agreement_id:a2.id,
    expected_version:2,expected_funding_version:1,
  },first.id),/版本|冲突|更新/);
  assert.equal(s.projects.get(first.id).funding.agreement_id,null);
});

test("after stocking, framework is frozen but agreement can still be revised in project edit until closure",t => {
  const {s,user,f1,f2,a1}=base(t);
  const first=s.projects.save(user,{name:"待入库",framework_id:f1.id});
  const stocked=s.projects.stock(user,first.id,{expected_version:first.version});
  assert.equal(stocked.status,"stocked");
  assert.throws(()=>s.projects.save(user,{
    name:"错误修改框架",framework_id:f2.id,agreement_id:null,
    expected_version:first.profile_version,
  },first.id),/子项目入库后不可变更年度框架/);
  const revised=s.projects.save(user,{
    name:"档案更新并选择协议",framework_id:f1.id,agreement_id:a1.id,
    expected_version:first.profile_version,expected_funding_version:0,
  },first.id);
  assert.equal(revised.framework_id,f1.id);
  assert.equal(revised.funding.agreement_id,a1.id);
  assert.throws(()=>s.projects.save(user,{
    name:"无效更正",framework_id:f2.id,agreement_id:null,
    expected_version:revised.profile_version,expected_funding_version:1,
  },first.id),/子项目入库后不可变更年度框架/);
});
