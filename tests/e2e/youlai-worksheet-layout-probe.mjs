import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";

const cleanup=[];
const { s, user, save, object, unit, demandInput }=fixture({after: fn=>cleanup.push(fn)});
const shapes=[[100,10,1000],[500,15,2000],[1000,20,3000]];
const cases=shapes.map(([rows,columns,targetMs])=>{
  const operation=save("operations",{
    name:`正式工作表尺寸性能 ${rows}×${columns}`, work_object_id:object.id,default_unit_id:unit.id,completion_standard:"测试业务标准",
    attributes_schema_json:Array.from({length:columns-6},(_,index)=>({
      key:"size_probe_"+index,label:"尺寸试验属性"+index,scope:"location",source:"manual",type:"text",
      requirement:"optional",pricing:false,enabled:true,sort_order:index+1,hint:"",
    })),
  });
  const work_locations=Array.from({length:rows},(_,index)=>({
    location_kind:"physical_tower",physical_tower_id:save("physical",{asset_no:`EXACT-${rows}-${index}`,tower_material:"angle"}).id,
    quantity_scaled:10000,
  }));
  const demand=s.demands.save(user,{...demandInput,
    operation_id:operation.id,problem_description:`规模审计 ${rows}×${columns}`,work_locations});
  return {demand,rows,columns,targetMs};
});
const http=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
let browser;
try{
  await new Promise(ok=>http.listen(0,"127.0.0.1",ok));
  const base="http://127.0.0.1:"+http.address().port;
  browser=await chromium.launch(existsSync(chromium.executablePath()) ? {headless:true} : {headless:true,channel:"chrome"});
  const results=[];
  for(const {demand,rows,columns,targetMs} of cases){
    const ctx=await browser.newContext({viewport:{width:1920,height:1080},colorScheme:"light"});
    try {
      const page=await ctx.newPage();
      const errors=[];page.on("pageerror",error=>errors.push(error.message));
      await page.goto(base+"/#/login");
      await page.getByPlaceholder("用户名").fill("admin");
      await page.getByPlaceholder("密码").fill("Schema113-test-password");
      await page.getByRole("button",{name:"登录",exact:true}).click();
      await page.waitForURL(/#\/dashboard/);
      await page.goto(base+"/#/business/demands/edit/"+demand.id);
      await page.getByRole("tab",{name:`作业位置（${rows}）`,exact:true}).waitFor();
      const click=performance.now();
      await page.getByRole("tab",{name:`作业位置（${rows}）`,exact:true}).click();
      const sheet=page.locator('[data-grid-key="demands:positions"]');
      await worksheetCanvas(sheet);
      const measurement=JSON.parse(await sheet.locator(".worksheet-canvas").getAttribute("data-load-metrics"));
      assert.equal(measurement.rows,rows);
      assert.equal(measurement.columns,columns);
      assert.deepEqual(errors,[]);
      const result={...measurement,clickMs:Math.round(performance.now()-click),targetMs};
      results.push(result);
      console.log("WORKSHEET_EXACT_DIMENSION_RESULT",JSON.stringify(result));
      if (rows === 100) {
        const details = page.locator('.el-collapse[aria-label="位置属性及移除"]');
        const pagination = page.locator(".el-pagination .el-pager");
        const position = details.locator(".el-collapse-item").filter({ hasText: "EXACT-100-99" });
        assert.equal(await details.locator(".el-collapse-item").count(), 20);
        await pagination.getByText("5", { exact: true }).click();
        await position.getByRole("button").first().click();
        await position.getByRole("button",{name:"移除该位置"}).waitFor();
        await pagination.getByText("1", { exact: true }).click();
        assert.equal(await position.count(), 0);
        await pagination.getByText("5", { exact: true }).click();
        await position.getByRole("button",{name:"移除该位置"}).waitFor();
        assert.equal(measurement.rows, 100);
        console.log("WORKSHEET_DETAIL_PAGING_OK all 100 records and native position metadata across pages");
      }
    }finally{await ctx.close()}
  }
  assert.ok(results.every(item=>item.totalMs<=item.targetMs && item.clickMs<=item.targetMs),JSON.stringify(results));
  console.log("WORKSHEET_EXACT_DIMENSIONS_OK");
}finally{
  await browser?.close();
  await new Promise(ok=>http.shutdown(ok));
  for(const task of cleanup.reverse())await task();
}
