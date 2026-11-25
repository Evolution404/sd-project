import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,save,operation}=fixture({after:fn=>cleanup.push(fn)});
const framework=save("frameworks",{name:"多选需求UI验收框架",fiscal_year:2026,limit_fen:600000});
const project=s.projects.save(user,{name:"多选需求表格验收子项目",framework_id:framework.id});
const demands=[];
for(let n=0;n<37;n++){
  const tower=save("physical",{tower_code:"DEMAND-PICKER-"+String(n+1).padStart(3,"0")});
  const demand=s.demands.save(user,{
    operation_id:operation.id,
    problem_description:"需求表格选择器位置"+String(n+1).padStart(3,"0"),
    work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:(n%3+1)*10000}],
    sources:[{description:"模拟巡检详情-"+n}],
  });
  if(n!==36)s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
  demands.push(demand);
}
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
const errors=[];
const page=await browser.newPage({viewport:{width:1920,height:1080}});
page.on("pageerror",error=>errors.push(error.message));
const out=join(process.cwd(),"test-results/schema113/project-demand-picker");
mkdirSync(out,{recursive:true});
try{
  await page.goto("http://127.0.0.1:"+server.address().port+"/#/projects?project="+project.id+"&tab=scope");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  const workspace=page.locator(".business-detail-dialog:visible");
  await workspace.waitFor();
  await workspace.getByRole("tab",{name:"承接需求",exact:true}).click();
  await workspace.getByRole("button",{name:"关联需求",exact:true}).click();
  const picker=page.getByRole("dialog",{name:"关联专业需求"});
  await picker.getByText("符合条件 36 条").waitFor();
  assert.equal(await picker.locator(".el-select").count(),0,"no single-record dropdown may remain in this picker");
  assert.equal(await picker.locator(".el-table__body-wrapper tr").count(),30);
  await picker.getByRole("button",{name:"全选本页",exact:true}).click();
  await picker.getByText("已选 30 条专业需求").waitFor();
  await picker.locator(".el-pagination .btn-next").click();
  await picker.getByText("第 2 页").waitFor();
  assert.equal(await picker.locator(".el-table__body-wrapper tr").count(),6);
  await picker.getByLabel("选择需求："+demands[0].demand_no).check();
  await picker.getByText("已选 31 条专业需求").waitFor();
  await picker.getByRole("button",{name:"查看需求详情："+demands[0].demand_no}).click();
  const preview=page.getByRole("dialog",{name:"专业需求详情"});
  await preview.getByText("需求表格选择器位置001").waitFor();
  await preview.getByRole("columnheader",{name:"作业位置"}).waitFor();
  await preview.getByRole("button",{name:"返回需求选择"}).click();
  await picker.locator(".el-pagination .btn-prev").click();
  await picker.getByText("第 1 页").waitFor();
  await picker.getByText("已选 31 条专业需求").waitFor();
  await picker.screenshot({path:join(out,"跨页31条需求已选.png")});
  await picker.getByRole("button",{name:"关联已选需求（31）"}).click();
  await picker.waitFor({state:"hidden"});
  assert.equal(s.projects.get(project.id).scopes.filter(row=>row.binding).length,31);
  assert.equal(s.demands.get(demands[0].id).binding?.project_id,project.id);
  assert.ok(!s.demands.get(demands[36].id).binding,"pending demand was not silently included");
  await workspace.getByRole("button",{name:"关联需求",exact:true}).click();
  const again=page.getByRole("dialog",{name:"关联专业需求"});
  await again.getByText("符合条件 5 条").waitFor();
  await again.getByText("包含待确认需求（确认有效后方可立项）").click();
  await again.getByText("符合条件 6 条").waitFor();
  await again.getByLabel("选择需求："+demands[36].demand_no).check();
  await again.getByText("包含待确认需求（确认有效后方可立项）").click();
  await again.getByText("已选 0 条专业需求").waitFor();
  await again.getByRole("button",{name:"取消",exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log("PROJECT_DEMAND_PICKER_BROWSER_OK 36 active + 1 pending, cross-page 31 atomic links, preview, re-query, pending filter and no dropdown");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const fn of cleanup.reverse())await fn();
}
