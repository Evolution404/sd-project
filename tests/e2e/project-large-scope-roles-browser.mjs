import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {fixture} from '../helpers.mjs';
import {httpServer} from '../../dist/server/platform/http/server.js';
const cleanup=[];
const {s,user,save,operation}=fixture({after:fn=>cleanup.push(fn)});
const towers=Array.from({length:20},(_,index)=>save('physical',{asset_no:'LARGE-'+String(index+1).padStart(2,'0'),tower_material:'angle'}));
const demand=s.demands.save(user,{operation_id:operation.id,problem_description:'20处位置的正式承接范围',expected_on:'2027-06-30',work_locations:towers.map(row=>({location_kind:'physical_tower',physical_tower_id:row.id,quantity_scaled:30000}))});
s.demands.transition(user,demand.id,{status:'active',expected_version:1,expected_event_seq:1});
const framework=save('frameworks',{name:'大范围四角色框架',fiscal_year:2026,limit_fen:10000000});
let project=s.projects.save(user,{name:'大范围四角色项目',framework_id:framework.id});
project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
project=s.projects.stock(user,project.id,{expected_version:1});
project=s.projects.approvalDraft(user,project.id,{expected_version:2,approved_budget_fen:100000,scopes:[{project_scope_id:project.scopes[0].id,demand_version:1,locations:demand.work_locations.map(row=>({location_item_no:row.item_no,approved_quantity_scaled:row.quantity_scaled}))}]});
project=s.projects.approve(user,project.id,project.approvals[0].id,{expected_version:2});
const originalApproval=project.approval.id;
const passwords={admin:'Schema113-test-password',editor:'Large-Editor-Password',verifier:'Large-Verifier-Password',viewer:'Large-Viewer-Password'};
for(const role of ['editor','verifier','viewer'])s.auth.saveUser(user,{username:role,password:passwords[role],role,status:'active'});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:'chrome'});
const contexts=[],errors=[],out=join(process.cwd(),'test-results/dux/project-roles');
mkdirSync(out,{recursive:true});
async function open(role){
  const context=await browser.newContext({viewport:{width:1280,height:1000}});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(role+' '+error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/projects?project='+project.id+'&tab=approval');
  await page.getByLabel('用户名',{exact:true}).fill(role);await page.getByLabel('密码',{exact:true}).fill(passwords[role]);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('tab',{name:'批准与变更',exact:true}).click();
  return page;
}
try{
  const editor=await open('editor');
  await editor.getByRole('button',{name:'编制正式变更',exact:true}).click();
  const dialog=editor.locator('.el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible');
  const rows=dialog.locator('.el-table__body-wrapper tr');
  await rows.first().waitFor();
  assert.equal(await rows.count(),20);
  assert.equal(await rows.locator('.el-checkbox').count(),0,
    'project cannot select a subset of demand locations');
  assert.equal(await rows.locator('input.el-input__inner').count(),0,
    'project cannot change frozen demand quantities');
  await dialog.getByLabel('批准预算（元）',{exact:true}).fill('1100');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  const difference=editor.locator('.el-message-box:visible');
  await difference.getByText(/请核对本次正式变更/).waitFor();
  await difference.getByRole('button',{name:'已核对，编制变更',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  let after=s.projects.get(project.id),draft=after.approvals.find(row=>row.status==='draft');
  assert.equal(draft.scopes[0].locations.length,20);
  assert.equal(draft.scopes[0].quantity_scaled,600000);
  assert.equal(after.approval.id,originalApproval);
  assert.equal(await editor.getByRole('button',{name:'正式批准',exact:true}).isDisabled(),true);
  assert.equal(await editor.getByRole('button',{name:'编制正式变更',exact:true}).isDisabled(),true,
    'existing unapproved draft must prevent a second approval draft from UI');
  await editor.screenshot({path:join(out,'编辑编制变更.png'),fullPage:true});
  const verifier=await open('verifier');
  assert.equal(await verifier.getByRole('button',{name:'正式批准',exact:true}).isEnabled(),true);
  await verifier.getByRole('button',{name:'正式批准',exact:true}).click();
  const approved=verifier.waitForResponse(response=>response.url().endsWith('/approve') && response.request().method()==='POST');
  await verifier.locator('.el-message-box:visible .el-button--primary').click();
  assert.equal((await approved).status(),200);
  after=s.projects.get(project.id);
  assert.equal(after.approval.version_no,2);
  assert.equal(after.approval.approved_by,s.auth.login('verifier',passwords.verifier).user.id);
  assert.equal(after.approval.approved_budget_fen,110000);
  assert.equal(after.approvals.find(row=>row.id===originalApproval).scopes[0].quantity_scaled,600000);
  await verifier.screenshot({path:join(out,'审核正式批准.png'),fullPage:true});
  const viewer=await open('viewer');
  assert.equal(await viewer.getByRole('button',{name:'编制正式变更',exact:true}).isDisabled(),true);
  const bypass=await viewer.evaluate(async id=>{const response=await fetch('/api/projects/'+id+'/approvals',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'viewer-large-scope'},body:'{}'});return response.status;},project.id);
  assert.equal(bypass,403);
  await viewer.screenshot({path:join(out,'只读正式历史.png'),fullPage:true});
  const admin=await open('admin');
  assert.equal(await admin.getByRole('button',{name:'编制正式变更',exact:true}).isEnabled(),true);
  await admin.getByRole('button',{name:'更多管理操作',exact:true}).click();
  assert.equal(await admin.getByRole('menuitem',{name:'删除项目',exact:true}).isDisabled(),true,
    'approved project must close before its record can be deleted');
  await admin.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log('PROJECT_LARGE_SCOPE_ROLES_OK all20 complete immutable demand positions, budget change only, editor drafts, verifier approves, viewer403, original history retained');
}finally{
  for(const context of contexts.reverse())await context.close();
  await browser.close();await new Promise(resolve=>server.close(resolve));
  for(const done of cleanup.reverse())await done();
}
