
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectFormChoice } from "./field-helper.mjs";
import { fillSettlementPosition } from "./settlement-worksheet-helper.mjs";
import { activeEditor, workPage, confirmProjectApproval, approveSettlement, submitSettlement } from "./work-page-helper.mjs";

const password = "Training-browser-case-113!";
const cli = (args,env=process.env) => execFileSync(process.execPath,["scripts/training/instance.mjs",...args],{env,encoding:"utf8"});
const id = cli(["create","--scenario"],{...process.env,SD_TRAINING_ADMIN_PASSWORD:password}).match(/[a-f0-9]{32}/)[0];
const directory = join(process.cwd(),"data-training","instances",id);
process.env.SD_TRAINING_INSTANCE_ID = id;
process.env.SD_TRAINING_DATA_DIR = directory;
const system = createSystem(directory);
const { user } = system.auth.login("trainer",password);
const server = httpServer(system);
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const base = "http://127.0.0.1:"+server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true} : {headless:true,channel:"chrome"});
const page = await browser.newPage({viewport:{width:1450,height:1000}});
const out = "test-results/p10/practice-journey";
mkdirSync(out,{recursive:true});
const detail = page.locator(".business-detail-dialog:visible");
const finance = page.getByRole("region",{name:"费用与结算",exact:true});
const editor = activeEditor(page);
const guide = page.getByRole("dialog",{name:"使用指引"});
const errors=[];
page.on("pageerror", error=>errors.push(error.message));
const writes=[];
page.on("request",request=>{
  if(request.method()!=="GET"&&request.url().includes("/api/"))writes.push(request.url());
});
const snapshot = () => system.training.journey(user);
const guideToggle = () => detail.getByRole("button",{name:"使用指引",exact:true});
async function showPractice(expected) {
  if(await guideToggle().isVisible()) await guideToggle().click();
  else await page.locator('header [data-guide-action="app.help"]').click();
  await guide.getByRole("tab",{name:"全流程实操"}).click();
  if(expected) await guide.getByRole("heading",{name:expected,exact:true}).waitFor();
}
async function locateHelp(id,title,expected) {
  if(await guideToggle().isVisible()) await guideToggle().click();
  else await page.locator('header [data-guide-action="app.help"]').click();
  await guide.getByRole("tab",{name:"操作搜索"}).click();
  await guide.getByRole("textbox",{name:"搜索业务操作说明"}).fill(id);
  const entry=guide.getByRole("button",{name:title,exact:true});
  if(await entry.getAttribute("aria-expanded")!=="true") await entry.click();
  const before = writes.length;
  await guide.getByRole("button",{name:"定位当前按钮",exact:true}).first().click();
  await guide.waitFor({state:"hidden"});
  const tour=page.locator(".el-tour__content:visible");
  await tour.getByText(expected).waitFor();
  assert.equal(writes.length,before,"帮助定位不执行业务写入");
  await page.keyboard.press("Escape");
  await tour.waitFor({state:"hidden"});
}
async function proceed() {
  const before = writes.length;
  await guide.getByRole("button",{name:"前往办理",exact:true}).click();
  await guide.waitFor({state:"hidden"});
  assert.equal(writes.length,before,"指引跳转不执行业务写入");
}
async function leaveGuide() {
  await guide.getByRole("button",{name:"关闭此对话框",exact:true}).click();
  await guide.waitFor({state:"hidden"});
}
async function closeDetail() {
  await detail.getByRole("button",{name:"关闭详情",exact:true}).click();
  await detail.waitFor({state:"hidden"});
}
async function confirm() {
  const box=page.locator(".el-message-box:visible");
  await box.locator(".el-button--primary").click();
  await box.waitFor({state:"hidden"});
}
async function save(label="保存") {
  await editor.getByRole("button",{name:label,exact:true}).click();
  await editor.waitFor({state:"hidden"});
}
async function choice(label,value) { await selectFormChoice(page,label,value,editor); }
async function approveDraft(change=false) {
  await detail.getByRole("button",{name:change?"编制变更":"编制立项",exact:true}).click();
  await editor.getByLabel("批准预算（元）",{exact:true}).fill(change?"13000":"12000");
  await save(change?"核对并保存变更草稿":"保存批准草稿");
  await detail.getByRole("button",{name:change?"审核变更":"审核立项",exact:true}).click();
  await confirmProjectApproval(page);
  await page.getByText("确认正式批准成功，正在刷新业务状态",{exact:true}).last().waitFor();
}
async function bill(itemized=false) {
  await finance.getByRole("tab", { name: "结算单", exact: true }).click();
  await finance.getByRole("button",{name:"新增结算",exact:true}).click();
  if(itemized) {
    await editor.getByText("按子费用",{exact:true}).click();
    await choice("费用科目","人工费");
    await editor.getByLabel("依据",{exact:true}).fill("训练核对科目");
  }
  await editor.getByLabel("本次金额（元）",{exact:true}).fill(itemized?"3800":"6000");
  await editor.getByLabel("结算依据",{exact:true}).fill(itemized?"训练第二期":"训练第一期");
  if (itemized) {
    const { projectId, demandId } = snapshot().facts;
    const project = system.projects.get(projectId);
    const scope = project.approvals.find(version=>version.id===project.approval.id).scopes.find(row=>row.demand_id===demandId);
    for (const location of scope.locations) {
      const position = JSON.parse(location.frozen_location);
      const name = position.location_label || position.tower_no || position.asset_no || location.location_object;
      const quantity = String(location.approved_quantity_scaled / 10000);
      await fillSettlementPosition(editor,{demandNo:system.demands.get(demandId).demand_no,
        locationLabel:name,quantity,evidence:"训练现场完成依据"});
    }
  }
  await save("保存草稿");
  const document=system.finance.settlements(snapshot().facts.projectId)
    .find(row=>row.draft?.document.basis===(itemized?"训练第二期":"训练第一期"));
  const row=finance.getByRole("row").filter({hasText:document.number}).first();
  await submitSettlement(page,row);
  await row.getByText(/待审核/).waitFor();
  return {row,document};
}

try {
  await page.goto(base+"/#/dashboard");
  await page.getByLabel("用户名",{exact:true}).fill("trainer");
  await page.getByLabel("密码",{exact:true}).fill(password);
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.locator(".shell").waitFor();
  assert.equal(readFileSync(join(directory,"TRAINING-INSTANCE.json"),"utf8").includes("operationId"),true);
  assert.equal(snapshot().facts,null);
  await showPractice("登记专业需求");
  await proceed();
  await choice("操作类型","【训练】防鸟装置安装");
  await editor.getByLabel("问题描述",{exact:true}).fill("发现杆塔上防鸟设备缺失");
  await editor.getByLabel("预计解决时间",{exact:true}).fill("2027-02-28");
  await editor.getByRole("button",{name:"添加作业位置",exact:true}).click();
  const picker=page.getByRole("dialog",{name:"添加作业位置",exact:true});
  await picker.locator(".picker-filters .el-select").first().click();
  await page.getByRole("option",{name:/青禾线/}).last().click();
  await picker.locator(".el-table__body-wrapper tr").first().waitFor();
  await picker.getByRole("button",{name:"全选筛选结果",exact:true}).click();
  await picker.getByRole("button",{name:"添加已选位置",exact:true}).click();
  await picker.waitFor({state:"hidden"});
  await editor.getByRole("tab",{name:"作业位置与工作量",exact:true}).click();
  const quantities=editor.locator(".quantity-cell input:visible");
  for(const input of await quantities.all()) await input.fill("1");
  await save("保存需求版本");
  await detail.getByRole("button",{name:"确认并待承接",exact:true}).waitFor();
  await showPractice("确认并退回需求");
  await proceed();
  await detail.getByRole("button",{name:"确认并待承接",exact:true}).click();
  await confirm();
  await detail.getByRole("button",{name:"关联子项目",exact:true}).waitFor();
  await locateHelp("demands.return","退回修改 · 专业需求",/打开高亮的菜单后选择「退回修改」/);
  await detail.getByRole("button",{name:"其他处理",exact:true}).click();
  await page.getByRole("menuitem",{name:"退回修改",exact:true}).click();
  await confirm();
  await showPractice("修订需求并重新确认");
  await leaveGuide();
  await detail.getByRole("button",{name:"修订需求",exact:true}).click();
  await editor.getByLabel("问题描述",{exact:true}).fill("现场复核后确认两基杆塔需补装");
  await save("保存需求版本");
  await detail.getByRole("button",{name:"确认并待承接",exact:true}).click();
  await confirm();
  await detail.getByRole("button",{name:"关联子项目",exact:true}).waitFor();
  await closeDetail();
  await showPractice("创建子项目并承接");
  await proceed();
  await editor.getByLabel("项目名称",{exact:true}).fill("青禾线防鸟治理训练项目");
  await choice("年度框架","【训练】输电检修年度框架");
  await save();
  await detail.getByRole("heading",{name:"青禾线防鸟治理训练项目"}).waitFor();
  await detail.getByRole("button",{name:"确认入库",exact:true}).click();
  await confirm();
  await detail.getByRole("tab",{name:"立项与变更",exact:true}).click();
  await approveDraft();
  await showPractice("批准一次项目变更");
  await leaveGuide();
  await detail.getByRole("tab",{name:"立项与变更",exact:true}).click();
  await approveDraft(true);
  await closeDetail();
  await showPractice("核定实际费用");
  await proceed();
  await finance.getByRole("tab",{name:"实际费用",exact:true}).click();
  await finance.getByRole("button",{name:"费用科目",exact:true}).click();
  await finance.getByRole("button",{name:"新增科目",exact:true}).click();
  await editor.getByLabel("名称",{exact:true}).fill("人工费");
  await save();
  await finance.getByRole("button",{name:"核定费用",exact:true}).click();
  await editor.getByLabel("费用事项",{exact:true}).fill("治理实际人工");
  await choice("末级费用科目","人工费");
  await editor.getByLabel("实际金额（元）",{exact:true}).fill("10000");
  await editor.getByLabel("发生日期",{exact:true}).fill("2026-11-21");
  await editor.getByLabel("费用凭据",{exact:true}).fill("训练凭据");
  await save();
  assert.equal(snapshot().facts.actualCost,1000000);
  const first=await bill();
  await first.row.getByRole("button",{name:"审核结算",exact:true}).click();
  const review=workPage(page);
  await locateHelp("finance.return","退回结算 · 费用与结算",/先填写退回原因/);
  await review.getByLabel("退回原因（选择退回时必填）").fill("核对原始票据");
  await review.getByRole("button",{name:"确认退回",exact:true}).click();
  await first.row.getByText(/已退回/).waitFor();
  assert.equal(snapshot().facts.approvedAmount,0);
  await locateHelp("finance.resubmit","原版重新提交 · 费用与结算",/沿用同一正式版本/);
  const version=system.finance.settlement(first.document.id).version.id;
  await first.row.getByRole("button",{name:"原版重新提交",exact:true}).click();
  await confirm();
  await first.row.getByText(/待审核/).waitFor();
  assert.equal(system.finance.settlement(first.document.id).version.id,version);
  await approveSettlement(page,first.row);
  await first.row.getByText(/已批准/).waitFor();
  assert.equal(snapshot().progressPercent,46.15);
  const second=await bill(true);
  await approveSettlement(page,second.row);
  await second.row.getByText(/已批准/).waitFor();
  assert.equal(snapshot().progressPercent,75.38);
  assert.ok(system.demands.get(snapshot().facts.demandId).work_locations.every(row=>row.remaining_quantity_scaled===0));
  await page.goto(base+"/#/projects?project="+snapshot().facts.projectId);
  await detail.getByRole("button",{name:"结项核对",exact:true}).click();
  const closure=page.getByRole("dialog",{name:"结项前业务核对",exact:true});
  await closure.getByRole("button",{name:"已核对差异，正式结项",exact:true}).click();
  await page.getByText("确认审核结项成功，正在刷新业务状态",{exact:true}).last().waitFor();
  assert.equal(snapshot().steps.filter(step=>step.completed).length,10);
  await closeDetail();
  await page.reload();
  await showPractice();
  await guide.getByText("全流程已完成。可以回查批准版本和结项结果。",{exact:true}).waitFor();
  await guide.getByText("75.38%",{exact:true}).waitFor();
  await page.screenshot({path:join(out,"全流程完成.png")});
  await guide.getByRole("button",{name:"查看结项历史",exact:true}).click();
  await detail.getByRole("heading",{name:"结项结果",exact:true}).waitFor();
  const projectId=snapshot().facts.projectId;
  await detail.getByRole("tab",{name:"承接需求",exact:true}).click();
  await locateHelp("projects.release","解除承接 · 子项目管理",/已结项，最新版正式批准范围仍包含该需求/);
  const roleNames=["editor","verifier","viewer"];
  for(const role of roleNames) {
    system.auth.saveUser(user,{username:"practice-"+role,password,role,status:"active"});
    const restricted=await browser.newPage({viewport:{width:1150,height:900}});
    try {
      await restricted.goto(base+"/#/projects?project="+projectId+"&tab=scope");
      await restricted.getByLabel("用户名",{exact:true}).fill("practice-"+role);
      await restricted.getByLabel("密码",{exact:true}).fill(password);
      await restricted.getByRole("button",{name:"登录",exact:true}).click();
      const panel=restricted.locator(".business-detail-dialog:visible");
      await panel.getByRole("heading",{name:"青禾线防鸟治理训练项目"}).waitFor();
      await panel.getByRole("tab", { name: "承接需求", exact: true }).click();
      await panel.getByRole("region", { name: "当前关联需求" }).getByRole("columnheader", { name: /^需求编号/ }).waitFor();
      const release=panel.locator('[data-guide-action="projects.release"]:visible');
      if (role === "editor") {
        await release.waitFor({timeout:10000});
        assert.match(await release.getAttribute("title"), /项目已结项/);
        assert.equal(await release.isDisabled(), true, "编辑不可解绑已结项批准范围");
      } else {
        assert.equal(await release.count(), 0, role+"无权变更承接关系");
      }
      await panel.getByRole("button",{name:"使用指引",exact:true}).click();
      const roleGuide=restricted.getByRole("dialog",{name:"使用指引"});
      await roleGuide.getByRole("tab",{name:"全流程实操"}).click();
      await roleGuide.getByText("请使用训练管理员账号办理。当前账号可核对案例状态。",{exact:true}).waitFor();
      assert.equal(await roleGuide.getByRole("button",{name:"前往办理",exact:true}).count(),0);
    } finally { await restricted.close(); }
  }
  assert.deepEqual(errors,[]);
  assert.equal(snapshot().facts.demandVersion,2);
  console.log("TRAINING_PRACTICE_BROWSER_OK ten persisted checkpoints, same demand/project, two settlement modes, 75.38%");
} catch(error) {
  await page.screenshot({path:join(out,"failure.png")});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  system.close();
  cli(["reset","--id="+id,"--confirm="+id]);
}

