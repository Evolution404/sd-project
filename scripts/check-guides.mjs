import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guideAnchorDeclarations } from "./lib/guide-anchor-audit.mjs";
import { guideModules } from "../web/src/guides/registry/modules.ts";
import { guideActions } from "../web/src/guides/registry/actions.ts";
import { guideCourses } from "../web/src/guides/registry/journeys.ts";
const navText=readFileSync("web/src/app/navigation.ts","utf8");
const expectedKeys=[...navText.matchAll(/\{\s*key:\s*"([^"]+)",\s*title:\s*"[^"]+",\s*icon:\s*\w+(?:,\s*adminOnly:\s*true)?\s*\}/g)].map(x=>x[1]);
const ids=guideModules.map(m=>m.id), courseIds=guideCourses.map(c=>c.id);
assert.equal(ids.length,12,"All 12 top-level user modules must exist");
assert.deepEqual([...new Set(ids)],ids,"Repeated module IDs");
assert.deepEqual([...expectedKeys].sort(),[...ids].sort(),"Guide modules must exactly match real menu");
assert.equal(guideCourses.length,12);
assert.deepEqual(courseIds,Array.from({length:12},(_,i)=>"L"+String(i+1).padStart(2,"0")));
assert.equal(new Set(guideActions.map(a=>a.id)).size,guideActions.length,"Repeated semantic action IDs");
assert.ok(guideActions.length>=80,"Insufficient baseline semantic inventory");
for(const module of guideModules){
  assert.equal(module.steps.length,5,module.id+" must have a five-step short tour");
  assert.ok(module.summary.trim());
  for(const step of module.steps){
    assert.ok(step.id.startsWith(module.id+"."));
    assert.ok(step.title.trim()&&step.description.trim());
  }
  assert.ok(guideActions.filter(a=>a.module===module.id).length>=3,module.id+" lacks action guidance");
}
assert.ok(guideActions.filter(a=>a.module==="excel").length>=8);
for(const action of guideActions){
  assert.ok(ids.includes(action.module)||action.module==="excel","Undeclared action module "+action.id);
  assert.ok(action.id.startsWith(action.module+"."));
  assert.ok(action.title&&action.purpose&&action.prerequisite&&action.result&&action.risk,"Incomplete action "+action.id);
  assert.ok(action.roles.length&&action.states.length);
  assert.ok(action.courseIds.length&&action.courseIds.every(x=>courseIds.includes(x)),"Orphaned course "+action.id);
}
for(const course of guideCourses){
  assert.ok(course.roles.length&&course.instructions.length>=4);
  assert.ok(course.purpose&&course.checkpoint);
  assert.ok(ids.includes(course.routeName)||course.routeName==="excel");
}
const {direct,delegated,all:anchoredIds}=guideAnchorDeclarations;
const anchored=guideActions.filter(action=>anchoredIds.has(action.id));
for(const module of guideModules)
  assert.ok(anchored.some(a=>a.module===module.id),
    module.id+" has no declared business control anchor");
assert.ok(direct.size>=18,"All 12 modules require stable direct locator declarations");
for(const id of anchoredIds)
  assert.ok(guideActions.some(a=>a.id===id), "Unexpected declared action anchor "+id);
const host=readFileSync("web/src/guides/components/GuideHost.vue","utf8");
assert.ok(host.includes("ElTour") && host.includes("ElDrawer") &&
  host.includes("locateAction") && host.includes("resolveGuideActionTarget"));
assert.ok(!host.includes("v-html")&&!host.includes("api(")&&!host.includes("fetch("),
  "Read-only GuideHost cannot execute business API commands or render unsafe HTML");
console.log("P10_REGISTRY_OK",guideModules.length,"modules,",guideActions.length,
  "semantic actions,",direct.size,"direct and",delegated.size,"delegated action anchors,",
  guideCourses.length,"L01-L12 courses, local static text, no guide writes");
