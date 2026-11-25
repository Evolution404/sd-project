// Deliberately opt-in: measures the real production settlement route, not a component demo.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { settlementCanvas } from "./youlai-settlement-grid-helpers.mjs";

const sizes=[100];
const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)}),{s,user,save,demandInput}=f;
const framework=save("frameworks",{fiscal_year:2026,name:"工作表性能专用框架",limit_fen:100000000});
const projects=[];
let server,browser,page;
const out=resolve("test-results/youlai-worksheet-disposal");
mkdirSync(out,{recursive:true});
try {
  for(const size of sizes){
    const start=performance.now();
    let project=s.projects.save(user,{name:"工作表规模-"+size,framework_id:framework.id});
    const demands=[];
    s.database.transaction(()=>{
      for(let offset=0;offset<size;offset+=5000){
        const count=Math.min(5000,size-offset);
        const positions=Array.from({length:count},(_,index)=>({
          location_kind:"physical_tower",physical_tower_id:save("physical",{asset_no:"SCALE-"+size+"-"+(offset+index),tower_material:"angle"}).id,
          quantity_scaled:10000,
        }));
        const demand=s.demands.save(user,{...demandInput,demand_no:undefined,problem_description:"工作表性能-"+size+"-"+offset,work_locations:positions});
        s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
        demands.push(demand);
        project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:project.version});
      }
      project=s.projects.stock(user,project.id,{expected_version:project.version});
      project=s.projects.approvalDraft(user,project.id,{expected_version:project.version,approved_budget_fen:1000000,
        scopes:project.scopes.map(scope=>{
          const demand=demands.find(row=>row.id===scope.demand_id);
          return {project_scope_id:scope.id,demand_version:demand.current_version,locations:demand.work_locations.map((loc,index)=>({location_item_no:index+1,approved_quantity_scaled:loc.quantity_scaled}))};
        }),
      });
      project=s.projects.approve(user,project.id,project.approvals[0].id,{expected_version:project.version});
    });
    projects.push({size,project});
    console.log("WORKSHEET_SCALE_SEED",JSON.stringify({size,elapsedMs:Math.round(performance.now()-start)}));
  }
  server=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+server.address().port;
  browser=await chromium.launch({headless:true,channel:"chrome"});
  page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
  page.setDefaultTimeout(120000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin:base});
  await page.goto(base+"/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(/#\/dashboard/);
  const {project}=projects[0];
  await page.goto(base+"/#/funding/finance");
  const inspector=await page.context().newCDPSession(page);
  async function snapshot() {
    await inspector.send("HeapProfiler.collectGarbage");
    const dom=await inspector.send("Memory.getDOMCounters");
    const heap=await inspector.send("Runtime.getHeapUsage");
    return {...dom,heapBytes:heap.usedSize};
  }
  async function cycle() {
    await page.getByRole("button",{name:"新增结算草稿"}).click();
    await page.getByRole("row").filter({has:page.getByRole("cell",{name:project.name,exact:true})})
      .getByRole("button",{name:"选择项目"}).click();
    const editor=page.getByRole("region",{name:"编制结算草稿"});
    await settlementCanvas(editor);
    assert.equal(await editor.locator(".settlement-work-canvas").count(),1);
    await editor.getByRole("button",{name:"返回结算列表"}).click();
    await editor.waitFor({state:"detached"});
    assert.equal(await page.locator(".settlement-work-canvas").count(),0);
  }
  await cycle();
  await cycle();
  const baseline=await snapshot();
  const samples=[baseline];
  for(let n=1;n<=30;n++) {
    await cycle();
    if(n%10===0) {
      const stats=await snapshot();
      samples.push(stats);
      console.log("WORKSHEET_DISPOSAL_SAMPLE",JSON.stringify({cycles:n,...stats}));
    }
  }
  const final=samples.at(-1);
  assert.deepEqual(errors,[]);
  assert.ok(final.jsEventListeners<=baseline.jsEventListeners+Math.max(10,Math.ceil(baseline.jsEventListeners*0.1)),JSON.stringify(samples));
  assert.ok(final.documents<=baseline.documents+1,JSON.stringify(samples));
  console.log("WORKSHEET_DISPOSAL_30_OK",JSON.stringify(samples));
}catch(error){await page?.screenshot({path:join(out,"failure.png"),fullPage:true}).catch(()=>{});throw error}
finally{await browser?.close();if(server)await new Promise(ok=>server.close(ok));for(const fn of cleanup.reverse())await fn()}
