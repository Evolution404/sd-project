import assert from "node:assert/strict";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {guideActions} from "../web/src/guides/registry/actions.ts";
import {guideModules} from "../web/src/guides/registry/modules.ts";
import {guideCourses} from "../web/src/guides/registry/journeys.ts";
import {nativeCrudGuideIds,crudGuideAction} from "../web/src/guides/registry/native-crud.ts";
import {nativeDynamicGuideIds,formSaveGuide,evidenceGuide} from "../web/src/guides/registry/native-bindings.ts";
import {nativeGuideDispositions} from "../web/src/guides/registry/native-dispositions.ts";
import {guideActions as legacyActions} from "../tests/fixtures/legacy-frontend/web/src/guides/registry/actions.ts";
const ids=new Set(guideActions.map(a=>a.id));
assert.equal(ids.size,guideActions.length);
assert.ok(legacyActions.every(a=>ids.has(a.id)),"All original explanations must be retained or explicitly migrated");
assert.equal(guideModules.length,12);assert.equal(guideCourses.length,12);
assert.ok(nativeCrudGuideIds.every(id=>ids.has(id)));
assert.equal(crudGuideAction("finance:costs:project-1","void"),"finance.cost-void");
assert.equal(crudGuideAction("equipment:physical","create"),"ledger.physical");
assert.equal(crudGuideAction("equipment:towers","create"),"ledger.logical");
assert.equal(crudGuideAction("funding:frameworks","create"),"frameworks.create");
assert.equal(crudGuideAction("funding:agreements","create"),"agreements.create");
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)])}
const direct=new Set();
for(const f of walk("web/src").filter(f=>f.endsWith(".vue")&&!f.includes("/guides/"))){
 const source=readFileSync(f,"utf8");
 for(const [,id] of source.matchAll(/(?<!:)data-guide-action="([\w.-]+)"/g)){
   assert.ok(ids.has(id),f+" missing explanation: "+id);direct.add(id);
 }
 for(const [,expr] of source.matchAll(/:data-guide-action="([^"]+)"/g))
   for(const [,id] of expr.matchAll(/'([\w.-]+\.[\w.-]+)'/g)){
     assert.ok(ids.has(id),f+" missing dynamic explanation: "+id);direct.add(id);
   }
}
for(const action of guideActions){
 assert.ok(action.purpose&&action.prerequisite&&action.result&&action.risk,action.id);
 assert.ok(action.courseIds.every(id=>guideCourses.some(c=>c.id===id)));
}
const host=readFileSync("web/src/guides/components/GuideHost.vue","utf8");
const practice=readFileSync("web/src/guides/components/PracticeJourney.vue","utf8");
const reader=readFileSync("web/src/guides/core/training-reader.ts","utf8");
assert.ok(host.includes("<ElTour")&&host.includes("<ElDrawer")&&host.includes(':target-area-clickable="false"'));
for(const source of [host,practice])assert.ok(!/\b(?:fetch|api|mutate)\s*\(|\.click\s*\(|v-html/.test(source),"Guides only explain and navigate");
assert.ok(reader.includes('method:"GET"')&&!/\b(?:POST|PUT|PATCH|DELETE)\b/.test(reader));
const toolbar=readFileSync("web/src/layouts/components/LayoutToolbar.vue","utf8");
assert.ok(toolbar.includes("<GuideHost")&&toolbar.includes('aria-label="使用指引"'));
const live=new Set([...direct,...nativeCrudGuideIds,...nativeDynamicGuideIds]);
assert.equal(formSaveGuide("funding:agreements"),"agreements.save");
assert.equal(formSaveGuide("equipment:towers"),"ledger.save");
assert.equal(evidenceGuide("source_id","delete"),"demands.evidence-delete");
assert.equal(evidenceGuide("settlement_version_id","revise"),"finance.evidence-revise");
for(const id of live)assert.ok(ids.has(id),"unknown live anchor "+id);
for(const [id,entry] of Object.entries(nativeGuideDispositions)){
 assert.ok(ids.has(id)&&!live.has(id),"disposition must refer to a known non-direct action "+id);
 assert.ok(entry.reason&&entry.reason.length>=10);
 if(entry.kind==="delegated")assert.ok(live.has(entry.target),"delegation without real anchor "+id);
 else assert.equal(entry.kind,"unavailable");
}
for(const id of ids)assert.ok(live.has(id)||nativeGuideDispositions[id],"unclassified original/current action "+id);
const delegated=Object.values(nativeGuideDispositions).filter(entry=>entry.kind==="delegated").length;
const unavailable=Object.values(nativeGuideDispositions).filter(entry=>entry.kind==="unavailable").length;
console.log("P10_PRODUCTION_REGISTRY_OK",guideActions.length,"semantic explanations,",guideModules.length,"modules,",guideCourses.length,"courses,",live.size,"declared current anchors,",delegated,"delegated,",unavailable,"legacy actions with no current independent control (not counted as live coverage)");
if(process.argv.includes("--write-inventory")){
 const lines=["# P10 正式有来操作覆盖复核（2026-11-24）","",
  "本清单来自正式 web/src 的语义注册、原生 CRUD 动态绑定及实际 Vue 声明。静态声明不是角色和状态组合的完整浏览器验收。旧版无独立入口明确列出，未经用户裁决不视为功能豁免。","",
  "全部说明："+guideActions.length+"；当前声明锚点："+live.size+"；合并路径："+delegated+"；旧版无当前独立入口："+unavailable+"。","",
  "| 模块 | 语义 ID | 操作 | 当前分类 | 绑定或办理说明 |","| --- | --- | --- | --- | --- |"];
 for(const a of guideActions){
   const d=nativeGuideDispositions[a.id];
   lines.push("| "+[a.module,a.id,a.title,live.has(a.id)?"当前声明锚点":d.kind==="delegated"?"合并路径":"新版无独立入口",live.has(a.id)?a.id:(d.target?d.target+"： ":"")+d.reason].map(x=>String(x).replaceAll("|","／")).join(" | ")+" |");
 }
 lines.push("","正式导览浏览器测试：tests/e2e/youlai-p10-guides-browser.mjs。独立训练：tests/e2e/youlai-p10-training-browser.mjs。L01～L12 服务端事实门禁：tests/api/training-business-journey.test.mjs。四角色项目：tests/e2e/youlai-y4-project-browser.mjs。","","注意：未列为当前声明锚点的旧动作不计入实际 UI 覆盖率；不得以本清单宣称旧版所有业务功能已迁移。");
 writeFileSync("docs/implementation/P10_正式有来操作覆盖复核_2026-11-24.md",lines.join("\n")+"\n");
}
