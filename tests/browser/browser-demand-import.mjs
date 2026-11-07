import {installUiContractMonitor,assertUiContract} from '../helpers/ui-contract.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from 'playwright';
import ExcelJS from 'exceljs';
import {navigate} from './browser-navigation.mjs';
import {selectUiOption} from '../helpers/select-ui-option.mjs';
const root=mkdtempSync(join(tmpdir(),'sd-browser-demand-import-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'import-browser',SD_ADMIN_PASSWORD:'test'}});
const {db,one,transaction}=await import('../../server/database/index.mjs');const {app}=await import('../../server/main.mjs');const {demandTemplate}=await import('../../server/infrastructure/excel/demand-workbook.mjs');
const {saveOperation}=await import('../../server/database/repositories/operation-profiles.mjs');
const time=new Date().toISOString();
transaction(()=>{
 db.prepare("INSERT INTO voltage_levels(id,code,name) VALUES('v','v','110kV')").run();
 db.prepare("INSERT INTO transmission_lines(id,line_code,name,voltage_level_id) VALUES('l','l','5000条浏览器合成线','v')").run();
 db.prepare("INSERT INTO physical_towers(id,tower_code) VALUES('p','P')").run();
 const tower=db.prepare("INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank,status) VALUES(?,?,'l','p',?,?,'active')");for(let n=1;n<=5000;n++)tower.run('t'+n,'c'+n,'#'+String(n).padStart(4,'0'),n);
 const item=db.prepare(`INSERT INTO dictionary_items
 (id,type_id,code,name,status,sort_order,version,fields_json,updated_at)
 VALUES(?,?,?,?,'active',1,1,'[]',?)`);
 item.run('u','unit','browser-import-u','导入测试套',time);
 item.run('u2','unit','browser-import-u2','处',time);
 item.run('s','source','browser-import-s','浏览器专项巡视',time);
 for(const [id,name,target,unit,standard] of [
  ['o2','浏览器基础加固','physical','u2','基础验收'],
  ['o','浏览器批量安装','line','u','安装完成验收']
 ]){
  const snap={id,type_id:'operation',code:id,name,status:'active',sort_order:1,
   version:1,work_target_type:target,default_unit_id:unit,default_quantity_scaled:null,
   completion_standard:standard,fields_json:'[]',updated_at:time,
   operation_profile:{location_kinds:['tower'],default_location_kind:'tower',
    default_target_object:'',entry_hint:''}};
  saveOperation(snap);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)').run(randomUUID(),
   id,1,JSON.stringify(snap),db.prepare("SELECT id FROM users WHERE role='admin'").get().id,time);
 }

});
db.prepare("INSERT INTO line_spans VALUES('browser-span','l','t1','t2','active',1,?,?,?)").run(db.prepare("SELECT id FROM users WHERE role='admin'").get().id,time,time);
let browser,page;
try{
 app.listen(0,'127.0.0.1');await once(app,'listening');const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:1000}});page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installUiContractMonitor(page);
 await context.request.post(origin+'/api/auth/login',{data:{username:'import-browser',password:'test'}});await page.goto(origin);await navigate(page,'新建需求');
 const spanResponse=await context.request.post(origin+'/api/dictionary-items',{data:{type_id:'operation',name:'浏览器档距检修',work_target_type:'line',default_unit_id:'u',default_quantity:'3',completion_standard:'档距验收',operation_profile:{location_kinds:['tower','span'],default_location_kind:'span',default_target_object:'导线',entry_hint:'核对起终点'}}});assert.ok(spanResponse.ok());
 await page.reload();await navigate(page,'新建需求');await page.getByRole('button',{name:'添加一组需求',exact:true}).click();let group=page.getByRole('dialog',{name:'添加一组需求'});
 await selectUiOption(group.getByLabel('操作类型'),{label:'浏览器档距检修'});assert.equal(await group.getByLabel('作业位置',{exact:true}).evaluate(el=>el.closest('.el-select')?.innerText.trim()||el.value),'档距');assert.equal(await group.getByLabel('共同处理部位').inputValue(),'导线');assert.equal(await group.getByLabel('每档工作量',{exact:true}).inputValue(),'3');
 await selectUiOption(group.getByLabel('选择线路'),{label:'110kV · 5000条浏览器合成线'});await group.getByRole('checkbox',{name:'选择档距 #0001—#0002',exact:true}).locator('xpath=..').click();
 await selectUiOption(group.getByLabel('操作类型'),{label:'浏览器基础加固'});let switchConfirm=page.getByRole('dialog',{name:'切换操作定义'});await switchConfirm.getByRole('button',{name:'保留原操作'}).click();assert.equal(await group.getByLabel('作业位置',{exact:true}).evaluate(el=>el.closest('.el-select')?.innerText.trim()||el.value),'档距');assert.ok(await group.getByRole('checkbox',{name:'选择档距 #0001—#0002',exact:true}).isChecked());
 await selectUiOption(group.getByLabel('操作类型'),{label:'浏览器基础加固'});await page.getByRole('dialog',{name:'切换操作定义'}).getByRole('button',{name:'切换并核对'}).click();assert.equal(await group.getByLabel('作业位置',{exact:true}).inputValue(),'杆塔');assert.equal(await group.getByLabel('计量单位').inputValue(),'处');assert.equal(await group.locator('.preview-table tbody tr').count(),0);await assertUiContract(page);
 await group.getByRole('button',{name:'关闭此对话框'}).click();await page.getByRole('dialog',{name:'放弃本组修改？'}).getByRole('button',{name:'放弃本组修改',exact:true}).click();await group.waitFor({state:'hidden'});assert.equal(one('SELECT COUNT(*) n FROM demands').n,0);
 await page.getByRole('button',{name:'下载模板',exact:true}).click();const templateModal=page.getByRole('dialog',{name:'下载需求导入模板'});
 await assertUiContract(page);
 await templateModal.getByLabel('来源发现日期',{exact:true}).click();
 const calendar=page.locator('.el-picker-panel:visible').last();await calendar.waitFor();
 assert.ok(await calendar.locator('.el-date-table td').first().evaluate(el=>parseFloat(getComputedStyle(el).height)>=24&&getComputedStyle(el).boxSizing==='border-box'),'日期组件样式应已加载');
 await assertUiContract(page);await templateModal.getByLabel('来源发现日期',{exact:true}).press('Escape');
 await selectUiOption(templateModal.getByLabel('涉及线路'),{label:'110kV · 5000条浏览器合成线'});await selectUiOption(templateModal.getByLabel('涉及操作'),{label:'浏览器批量安装'});
 const downloadPromise=page.waitForEvent('download');await templateModal.getByRole('button',{name:'生成并下载'}).click();const download=await downloadPromise;const downloaded=new ExcelJS.Workbook();await downloaded.xlsx.load(readFileSync(await download.path()));assert.ok(downloaded.getWorksheet('来源依据'));assert.equal(downloaded.getWorksheet('需求明细').getCell('H2').value,'浏览器批量安装');
 const buffer=await demandTemplate({line_ids:['l'],operation_ids:['o'],include_positions:true,quantity:'2',target_object:'横担上部',problem_description:'专项检查问题',sources:[{source_key:'LY001',type_id:'s',discovered_on:'2026-11-01',proposed_by:'合成测试班组'}]});
 const file=new ExcelJS.Workbook();await file.xlsx.load(buffer);file.getWorksheet('需求明细').getCell('L2').value='';file.getWorksheet('需求明细').getCell('J5001').value='0';
 await page.getByRole('button',{name:'Excel 导入',exact:true}).click();let modal=page.getByRole('dialog',{name:'Excel 导入需求'});
 assert.equal(await modal.locator('input[type=file]').isVisible(),false,'ElUpload必须隐藏原生文件控件，缺少upload样式应阻断验收');await assertUiContract(page);
 await modal.locator('input[type=file]').evaluate(el=>el.style.display='inline-block');await assert.rejects(()=>assertUiContract(page),/运行界面不允许/);await modal.locator('input[type=file]').evaluate(el=>el.style.removeProperty('display'));await assertUiContract(page);
 await modal.locator('input[type=file]').setInputFiles({name:'5000条需求.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await file.xlsx.writeBuffer())});
 await modal.getByLabel('需求工作表').waitFor();await modal.getByRole('button',{name:'解析并加入核对清单'}).click();await modal.waitFor({state:'hidden'});
 const workspace=page.locator('.demand-batch-workspace');await workspace.getByText('待完善 2 条',{exact:true}).waitFor();assert.equal(one('SELECT COUNT(*) n FROM demands').n,0);
 assert.equal(await workspace.locator('.el-table__body-wrapper tbody tr').count(),2,'default filter focuses only on invalid rows');
 mkdirSync('test-results/demand-import',{recursive:true});
 for(const width of [1500,1280,960,760]){
  await page.setViewportSize({width,height:1000});await assertUiContract(page);
  const geometry=await workspace.evaluate(el=>{const root=el.getBoundingClientRect();const bad=[...el.querySelectorAll('button,.batch-toolbar .el-select,.batch-toolbar .el-input')].filter(n=>!n.closest('.el-table')&&n.getBoundingClientRect().width>0).filter(n=>{const r=n.getBoundingClientRect();return r.left<root.left-1||r.right>root.right+1}).map(n=>n.textContent);return {width:document.documentElement.scrollWidth,viewport:innerWidth,bad}});
  assert.ok(geometry.width<=geometry.viewport+1,JSON.stringify(geometry));assert.deepEqual(geometry.bad,[]);await page.screenshot({path:'test-results/demand-import/batch-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1500,height:1000});
 await workspace.getByRole('button',{name:/来源依据/}).click();let sourceModal=page.getByRole('dialog',{name:'本批来源依据'});await sourceModal.getByRole('button',{name:'新增来源'}).click();let sourceEditor=page.getByRole('dialog',{name:'编辑来源依据'});await sourceEditor.getByLabel('来源编号',{exact:true}).fill('LY-CRUD');await sourceEditor.getByRole('button',{name:'保存来源并检查'}).click();await sourceEditor.locator('.el-form-item__error').first().waitFor();
 await selectUiOption(sourceEditor.getByLabel('来源类型',{exact:true}),{label:'浏览器专项巡视'});await sourceEditor.getByLabel('发现／提出日期',{exact:true}).fill('2026-11-03');await sourceEditor.getByLabel('提出单位／人员',{exact:true}).fill('来源维护测试');await sourceEditor.getByRole('button',{name:'保存来源并检查'}).click();await sourceEditor.waitFor({state:'hidden'});
 let sourceRow=sourceModal.getByRole('row').filter({hasText:'LY-CRUD'});await sourceRow.getByRole('button',{name:'编辑',exact:true}).click();sourceEditor=page.getByRole('dialog',{name:'编辑来源依据'});await sourceEditor.getByLabel('提出单位／人员',{exact:true}).fill('来源维护修正');await sourceEditor.getByRole('button',{name:'保存来源并检查'}).click();await sourceEditor.waitFor({state:'hidden'});await sourceRow.getByText('来源维护修正',{exact:true}).waitFor();await sourceRow.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除未提交来源'}).getByRole('button',{name:'删除来源',exact:true}).click();await sourceRow.waitFor({state:'hidden'});await sourceModal.getByRole('button',{name:'关闭',exact:true}).click();
 await workspace.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('草稿已保存',{exact:true}).first().waitFor();await assertUiContract(page);
 await page.reload();await navigate(page,'新建需求');await page.getByRole('button',{name:/查看草稿/}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();await page.getByRole('dialog',{name:'需求草稿',exact:true}).waitFor({state:'hidden'});await workspace.getByText('共 5000 条',{exact:true}).first().waitFor();
 await selectUiOption(workspace.getByLabel('检查结果筛选'),{label:'待完善'});await workspace.locator('.el-table__header-wrapper .el-checkbox').first().click();await workspace.getByRole('button',{name:'批量修改',exact:true}).click();
 modal=page.getByRole('dialog',{name:'批量修改所选需求'});await selectUiOption(modal.getByLabel('修改字段'),{label:'问题描述'});await modal.getByLabel('填入内容').fill('批量补充的现场问题');await modal.getByRole('button',{name:'应用并重新检查'}).click();await modal.waitFor({state:'hidden'});await workspace.getByText('待完善 1 条',{exact:true}).waitFor();
 await workspace.locator('.el-table__body-wrapper tbody tr').getByRole('button',{name:'编辑',exact:true}).click();modal=page.getByRole('dialog',{name:/编辑需求/});
 await page.setViewportSize({width:760,height:900});await modal.getByLabel('工作量',{exact:true}).fill('3.0001');await modal.getByRole('button',{name:'保存并检查本条'}).scrollIntoViewIfNeeded();
 const footer=await modal.getByRole('button',{name:'保存并检查本条'}).boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=900);await page.screenshot({path:'test-results/demand-import/edit-760.png',fullPage:true});await modal.getByRole('button',{name:'保存并检查本条'}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByText('待完善 0 条',{exact:true}).waitFor();await selectUiOption(workspace.getByLabel('检查结果筛选'),{label:'全部明细'});
 assert.equal(await workspace.locator('.el-table__body-wrapper tbody tr').count(),100,'5000 rows are paginated, not mounted all at once');
 await workspace.getByRole('button',{name:'提交 5000 条核实',exact:true}).click();await page.getByRole('button',{name:'确认提交核实',exact:true}).click();await workspace.getByText(/本批已提交：新建 5000/).waitFor();assert.equal(one('SELECT COUNT(*) n FROM demands').n,5000);assert.equal(one("SELECT quantity_scaled FROM demands WHERE logical_tower_id='t5000'").quantity_scaled,30001);assert.equal(one('SELECT COUNT(*) n FROM source_records').n,1);
 assert.equal(await workspace.getByRole('button',{name:'提交 5000 条核实'}).isDisabled(),true);
 await workspace.getByRole('button',{name:'新建批次',exact:true}).click();
 const duplicateBook=new ExcelJS.Workbook();await duplicateBook.xlsx.load(await demandTemplate({line_ids:['l'],operation_ids:['o'],blank_rows:1,quantity:'2',target_object:'横担上部',problem_description:'补充同一问题的来源依据',sources:[{source_key:'LY001',type_id:'s',discovered_on:'2026-11-02',proposed_by:'复核班组'}]}));duplicateBook.getWorksheet('需求明细').getCell('E2').value='#0001';
 await workspace.getByRole('button',{name:'Excel 导入',exact:true}).click();modal=page.getByRole('dialog',{name:'Excel 导入需求'});await modal.locator('input[type=file]').setInputFiles({name:'补充来源.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await duplicateBook.xlsx.writeBuffer())});await modal.getByLabel('需求工作表').waitFor();await modal.getByRole('button',{name:'解析并加入核对清单'}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByText('疑似重复 1 条',{exact:true}).first().waitFor();await workspace.locator('.el-table__body-wrapper tbody tr').getByRole('button',{name:'编辑',exact:true}).click();modal=page.getByRole('dialog',{name:/编辑需求/});assert.equal(await modal.getByLabel('单位',{exact:true}).inputValue(),'导入测试套');assert.equal(await modal.getByLabel('单位',{exact:true}).getAttribute('readonly')!==null,true);assert.equal(await modal.getByLabel('作业对象',{exact:true}).inputValue(),'线路侧设备');await selectUiOption(modal.getByLabel('操作类型',{exact:true}),{label:'浏览器基础加固'});await page.getByRole('dialog',{name:'按操作定义重新核对'}).getByRole('button',{name:'采用并重新核对'}).click();assert.equal(await modal.getByLabel('单位',{exact:true}).inputValue(),'处');assert.equal(await modal.getByLabel('作业对象',{exact:true}).inputValue(),'共用物理杆塔');assert.equal(await modal.getByLabel('工作量',{exact:true}).inputValue(),'2');await selectUiOption(modal.getByLabel('操作类型',{exact:true}),{label:'浏览器批量安装'});await page.getByRole('dialog',{name:'按操作定义重新核对'}).getByRole('button',{name:'采用并重新核对'}).click();await modal.getByRole('columnheader',{name:'历史来源依据',exact:true}).waitFor();await modal.getByText(/浏览器专项巡视 · 2026-11-01 · 合成测试班组/).waitFor();
 await selectUiOption(modal.getByLabel('处理方式',{exact:true}),{label:'关联已有需求来源'});await modal.getByLabel('判定依据',{exact:true}).fill('核对现场情况，为同一问题补充巡视依据，不新增工程量');await modal.getByRole('button',{name:'保存并检查本条'}).click();await modal.waitFor({state:'hidden'});await workspace.getByRole('button',{name:'提交 1 条核实',exact:true}).click();await page.getByRole('button',{name:'确认提交核实',exact:true}).click();await workspace.getByText(/本批已提交：新建 0 条待核实需求，关联已有需求 1 条/).waitFor();
 assert.equal(one('SELECT COUNT(*) n FROM demands').n,5000);assert.equal(one('SELECT COUNT(*) n FROM source_records').n,2);assert.equal(one("SELECT quantity_scaled FROM demands WHERE logical_tower_id='t1'").quantity_scaled,20000,'linking source never duplicates work quantity');
 await assertUiContract(page);assert.deepEqual(errors,[]);console.log('BROWSER_DEMAND_IMPORT_OK template download; 5000-row parse, error filters, draft reload, bulk fill, exact quantity, atomic submit; 1500/1280/960/760 geometry and screenshots');
}catch(error){if(page){console.log('IMPORT_UI_ERROR',await page.locator('.batch-alert,.el-alert__title,.el-message__content').allTextContents());mkdirSync('test-results/demand-import',{recursive:true});await page.screenshot({path:'test-results/demand-import/failure.png',fullPage:true})}throw error}
finally{if(browser)await browser.close();await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true})}
