import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {alignmentAudit} from "./youlai-alignment-helpers.mjs";
import {worksheetCanvas,selectWorksheetCell,typeWorksheetCell} from "./youlai-business-worksheet-helpers.mjs";
import {copySettlementSelection} from "./youlai-settlement-grid-helpers.mjs";

const cleanup=[];
const f=fixture({after:fn=>cleanup.push(fn)});
const {s,user,save,demandInput,operation}=f;
const pending=s.demands.save(user,demandInput);
const voltage=save("voltages",{name:"220kV"});
const lineA=save("lines",{name:"批选测试甲回",voltage_level_id:voltage.id});
const lineB=save("lines",{name:"批选测试乙回",voltage_level_id:voltage.id});
const physical=[15,16,17].map(no=>save("physical",{asset_no:"QA-"+no}));
const logical=physical.map((tower,index)=>save("towers",{line_id:lineA.id,tower_no:String(index+15),physical_mode:"shared",physical_tower_id:tower.id}));
const corridor=save("objects",{name:"批选通道测试对象",object_position:"corridor",attribution_unit:"logical_tower"});
const corridorOp=save("operations",{name:"批选通道测试操作",work_object_id:corridor.id,default_unit_id:f.unit.id,completion_standard:"准确匹配位置"});
const spans=logical.slice(0,2).map((tower,index)=>save("spans",{line_id:lineA.id,start_tower_id:tower.id,end_tower_id:logical[index+1].id,status:"active"}));
save("towers",{line_id:lineB.id,tower_no:"15",physical_mode:"shared",physical_tower_id:physical[1].id});
save("towers",{line_id:lineB.id,tower_no:"17"});
// Inserted towers are independent identities and may have either sign.
for(const no of ["1786","1786+1","1786-1","1787","1787-1"]){
  const tower=save("physical",{asset_no:"QA-insertion-"+no});
  save("towers",{line_id:lineA.id,tower_no:no,physical_mode:"shared",physical_tower_id:tower.id});
}
save("towers",{line_id:lineB.id,tower_no:"1786+2"});
async function checkInserted(picker){
  const input=picker.getByRole("textbox",{name:"杆号清单或连续区间"});
  for(const [query,count,expected,excluded] of [
    ["1786-1786",1,["1786"],["1786+1","1786-1","1787"]],
    ["1786-1787",4,["1786","1786+1","1786-1","1787"],["1787-1","1786+2"]],
    ["1786+1、1786-1",2,["1786+1","1786-1"],["1786","1787"]],
  ]){
    await input.fill(query);
    await picker.getByRole("button",{name:"匹配并选择",exact:true}).click();
    await picker.getByRole("button",{name:`添加所选位置（${count}）`,exact:true}).waitFor({timeout:8000});
    for(const no of expected) {
      const row=picker.getByRole("cell",{name:no,exact:true}).locator("..");
      await row.getByRole("cell",{name:"匹配成功",exact:true}).waitFor();
    }
    for(const no of excluded)assert.equal(await picker.getByRole("cell",{name:no,exact:true}).count(),0,no);
  }
}

const backend=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(ok=>backend.listen(0,"127.0.0.1",ok));
const base="http://127.0.0.1:"+backend.address().port;
const out=resolve("test-results/youlai-priority-ux");mkdirSync(out,{recursive:true});
const browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
try{
  for(const colorScheme of ["light","dark"]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,colorScheme});
    const page=await context.newPage(),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(base+"/#/login");
    await page.getByPlaceholder("用户名").fill("admin");
    await page.getByPlaceholder("密码").fill("Schema113-test-password");
    await page.getByRole("button",{name:"登录",exact:true}).click();
    await page.waitForURL(/#\/dashboard/);
    await page.getByText("1 项需关注",{exact:true}).waitFor();
    const attention=page.locator(".card").filter({has:page.getByRole("heading",{name:"需要关注",exact:true})});
    assert.equal(await attention.locator(".card__count").innerText(),"1 项");
    assert.equal(await attention.locator(".todo-row").count(),1);
    const center=await page.locator(".layout-user").evaluate(node=>{
      const a=node.querySelector(".layout-user__avatar"),b=node.querySelector(".layout-user__name"),c=a.querySelector(".el-icon,img");
      const middle=el=>{const r=el.getBoundingClientRect();return r.y+r.height/2;};
      return {avatarName:Math.abs(middle(a)-middle(b)),iconAvatar:Math.abs(middle(c)-middle(a))};
    });
    assert.ok(center.avatarName<=1&&center.iconAvatar<=1,JSON.stringify(center));
    await page.screenshot({path:join(out,"attention-"+colorScheme+".png"),animations:"disabled"});
    await attention.getByRole("button",{name:pending.demand_no,exact:true}).click();
    await page.waitForURL(url=>url.hash.includes("demand="+pending.id));
    await page.locator(".el-drawer:visible").getByText("防鸟设施缺失",{exact:true}).waitFor();
    await page.locator(".el-drawer:visible").getByRole("button",{name:"关闭",exact:true}).click();
    await page.waitForURL(url=>!url.hash.includes("demand="));
    await page.getByRole("button",{name:"新增专业需求",exact:true}).click();
    const op=page.getByRole("combobox",{name:"操作类型"});
    await op.fill(operation.name);await page.getByRole("option",{name:operation.name,exact:true}).click();
    await page.getByRole("textbox",{name:"问题描述"}).fill("连续表单保留值");
    const scroll=page.locator(".demand-scroll");
    assert.equal(await scroll.locator("[data-demand-section]").count(),4);
    assert.ok(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight),"long form must really scroll");
    const pos=scroll.locator('[data-demand-section="positions"]');
    const nav=scroll.locator(".demand-section-nav");
    await nav.getByRole("tab",{name:"作业位置（0）"}).click();
    await page.waitForFunction(()=>document.querySelector('.demand-section-nav .is-active')?.textContent.includes("作业位置"));
    const alignment=await pos.locator(".business-control-row").evaluate(node=>{
      const controls=[node.querySelector(".el-select"),...node.querySelectorAll(":scope > .el-button")];
      const middle=el=>{const r=el.getBoundingClientRect();return r.y+r.height/2;};
      const centers=controls.map(middle);
      return Math.max(...centers)-Math.min(...centers);
    });
    assert.ok(alignment<=1,"location toolbar center delta "+alignment);
    await page.screenshot({path:join(out,"long-form-positions-"+colorScheme+".png"),animations:"disabled"});
    await pos.getByRole("button",{name:"按杆号快速选择",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"按杆号快速选择"});
    await dialog.getByRole("combobox",{name:"所属线路"}).fill(lineA.name);
    await page.getByRole("option",{name:lineA.name,exact:true}).click();
    await checkInserted(dialog);
    await dialog.getByRole("textbox",{name:"杆号清单或连续区间"}).fill("15-17、15、999");
    await dialog.getByRole("button",{name:"匹配并选择",exact:true}).click();
    await dialog.getByText("成功匹配 3 处；现有 0 处，最多5000处",{exact:true}).waitFor();
    assert.equal(await dialog.getByRole("cell",{name:"匹配成功",exact:true}).count(),3);
    await dialog.getByRole("cell",{name:"清单重复",exact:true}).waitFor();
    await dialog.getByRole("cell",{name:"台账不存在或位置类型不适用",exact:true}).waitFor();
    const pickerGeometry=await alignmentAudit(page,".el-dialog");
    assert.deepEqual(pickerGeometry.violations,[]);
    await page.screenshot({path:join(out,"quick-picker-"+colorScheme+".png"),animations:"disabled"});
    await dialog.getByRole("button",{name:"添加所选位置（3）",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    let positionCanvas=await worksheetCanvas(pos);
    await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:base});
    const widths=[180,145,125,170,125,150];
    const chosen=[];
    for(let row=1;row<=3;row++){await selectWorksheetCell(positionCanvas,row,0,widths);chosen.push((await copySettlementSelection(page)).trim());}
    assert.deepEqual(chosen.slice().sort(),["QA-15","QA-16","QA-17"]);
    assert.equal(await pos.locator(".el-collapse-item__header").count(),0);
    await typeWorksheetCell(page,positionCanvas,1,2,widths,"7");
    await positionCanvas.click({button:"right",position:{x:36+180+145+30,y:63+1.5*34}});
    assert.equal(await page.getByText("删除",{exact:true}).count(),0,"no intermediate delete submenu");
    await page.getByText("删除选中行",{exact:true}).last().click({timeout:5000});
    await nav.getByRole("tab",{name:"作业位置（2）",exact:true}).waitFor();
    positionCanvas=await worksheetCanvas(pos);
    await selectWorksheetCell(positionCanvas,1,0,widths);
    assert.equal((await copySettlementSelection(page)).trim(),chosen[0]);
    await selectWorksheetCell(positionCanvas,1,2,widths);
    assert.equal((await copySettlementSelection(page)).trim(),"7");
    await selectWorksheetCell(positionCanvas,2,0,widths);
    assert.equal((await copySettlementSelection(page)).trim(),chosen[2]);
    await pos.getByRole("button",{name:"移除选中位置",exact:true}).click();
    await nav.getByRole("tab",{name:"作业位置（1）",exact:true}).waitFor();
    positionCanvas=await worksheetCanvas(pos);
    await selectWorksheetCell(positionCanvas,1,0,widths);
    assert.equal((await copySettlementSelection(page)).trim(),chosen[0]);
    console.log("NATIVE_REMOVE_ROW_OK",colorScheme);

    await nav.getByRole("tab",{name:"需求来源",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.demand-section-nav .is-active')?.textContent.includes("需求来源"));
    await scroll.evaluate(el=>el.scrollTop=0);
    await page.waitForFunction(()=>document.querySelector('.demand-section-nav .is-active')?.textContent.includes("基本信息"));
    assert.equal(await page.getByRole("textbox",{name:"问题描述"}).inputValue(),"连续表单保留值");
    // A manual wheel in the form must advance the navigation without a tab click.
    const source=scroll.locator('[data-demand-section="sources"]');
    const box=await scroll.boundingBox();
    const delta=await source.evaluate(el=>el.getBoundingClientRect().top);
    await page.mouse.move(box.x+box.width-20,box.y+box.height/2);
    await page.mouse.wheel(0,delta);
    await page.waitForFunction(()=>document.querySelector('.demand-section-nav .is-active')?.textContent.includes("需求来源"));
    await page.getByRole("button",{name:"返回专业需求",exact:true}).click();
    const discard=page.locator(".el-message-box:visible");
    await discard.getByRole("button",{name:"放弃修改",exact:true}).click();
    await page.getByRole("button",{name:"新增专业需求",exact:true}).click();
    await page.getByRole("combobox",{name:"操作类型"}).fill(corridorOp.name);
    await page.getByRole("option",{name:corridorOp.name,exact:true}).click();
    await page.getByRole("tab",{name:"作业位置（0）"}).click();
    async function quickMatch(text,label,expected){
      await page.getByRole("button",{name:"按杆号快速选择",exact:true}).click();
      const picker=page.getByRole("dialog",{name:"按杆号快速选择"});
      await picker.getByRole("combobox",{name:"所属线路"}).fill(lineA.name);
      await page.getByRole("option",{name:lineA.name,exact:true}).click();
      await picker.getByRole("textbox",{name:label}).fill(text);
      await picker.getByRole("button",{name:"匹配并选择",exact:true}).click();
      try{await picker.getByRole("button",{name:`添加所选位置（${expected}）`,exact:true}).waitFor({timeout:8000});}catch(error){console.error(await picker.innerText());throw error;}
      await picker.getByRole("button",{name:"取消",exact:true}).click();
      await picker.waitFor({state:"hidden"});
    }
    await quickMatch("15-17","杆号清单或连续区间",3);
    await page.getByRole("button",{name:"按杆号快速选择",exact:true}).click();
    const insertionPicker=page.getByRole("dialog",{name:"按杆号快速选择"});
    await insertionPicker.getByRole("combobox",{name:"所属线路"}).fill(lineA.name);
    await page.getByRole("option",{name:lineA.name,exact:true}).click();
    await checkInserted(insertionPicker);
    await insertionPicker.getByRole("button",{name:"取消",exact:true}).click();
    await insertionPicker.waitFor({state:"hidden"});
    console.log("INSERTED_TOWER_RANGE_OK",colorScheme,"physical and logical, closed endpoint, both signs, exact identity and line scope");

    await page.locator('[data-demand-section="positions"] .business-control-row .el-select').click();
    await page.getByRole("option",{name:"档距",exact:true}).click();
    await quickMatch("15~16、16~17","档距端点清单",2);
    assert.deepEqual(errors,[]);
    console.log("PRIORITY_UX_OK",colorScheme,JSON.stringify({center,alignment}));
    await context.close();
  }
}finally{
  await browser.close();await new Promise(ok=>backend.close(ok));
  for(const fn of cleanup.reverse())await fn();
}
