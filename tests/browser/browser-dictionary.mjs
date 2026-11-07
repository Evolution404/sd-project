import {selectUiOption} from '../helpers/select-ui-option.mjs';
import {navigate} from './browser-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import ExcelJS from 'exceljs';
const root=mkdtempSync(join(tmpdir(),'sd-dictionary-ui-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../../server/database/index.mjs');
const {app}=await import('../../server/main.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'dictionary-ui',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');const base='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function api(path){const response=await context.request.get(base+'/api'+path);assert.ok(response.ok(),path+': '+await response.text());return response.json()}
 const login=await context.request.post(base+'/api/auth/login',{data:{username:'dictionary-ui',password:'test'}});assert.ok(login.ok());
 await page.goto(base);await page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:'系统管理'}).click();await page.locator('.sidebar').getByRole('menuitem',{name:'数据字典',exact:true}).click();
 await page.getByRole('heading',{name:'数据字典',exact:true}).waitFor();await page.getByRole('row').filter({hasText:'35kV'}).waitFor();
 const output=join(process.cwd(),'test-results');mkdirSync(output,{recursive:true});
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:1080});
  await page.waitForFunction(()=>document.querySelector('.dictionary-columns')?.getBoundingClientRect().width>0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'desktop horizontal overflow at '+width);
  const columns=await page.locator('.dictionary-columns').evaluate(node=>Array.from(node.children).map(child=>child.getBoundingClientRect().top));
  assert.ok(Math.max(...columns)-Math.min(...columns)<2,'desktop must preserve three columns at '+width);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,'dictionary-'+width+'.png'),animations:'disabled'});
 }
 await page.setViewportSize({width:1440,height:1080});
 // Scrolling belongs to the main pane; header and sidebar stay in the viewport.
 await page.setViewportSize({width:1440,height:720});
 await page.locator('.application-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight});
 const frame=await page.evaluate(()=>({headerTop:document.querySelector('.application-header').getBoundingClientRect().top,
  sidebarBottom:document.querySelector('.application-sidebar').getBoundingClientRect().bottom,
  footerBottom:document.querySelector('.application-sidebar-footer').getBoundingClientRect().bottom,
  contentScroll:document.querySelector('.application-scroll').scrollTop,windowScroll:window.scrollY,height:innerHeight}));
 assert.ok(frame.contentScroll>0);assert.equal(frame.headerTop,0);assert.equal(frame.sidebarBottom,frame.height);assert.equal(frame.footerBottom,frame.height);assert.equal(frame.windowScroll,0);
 await page.screenshot({path:join(output,'application-frame-scrolled.png'),animations:'disabled'});
 await page.locator('.application-scroll').evaluate(node=>{node.scrollTop=0});await page.setViewportSize({width:1440,height:1080});
 async function select(panel,label,value){const combo=panel.getByRole('combobox',{name:label,exact:true});await selectUiOption(combo,{label:value});await combo.press('Escape')}
 const workspace=page.locator('.dictionary-workspace');
 assert.equal(await workspace.getByRole('columnheader',{name:'应用领域',exact:true}).count(),0);
 const groupLabels=await workspace.locator('.dictionary-categories > .el-card__body > .el-menu > .el-sub-menu .el-sub-menu__title').allTextContents();
 for(const label of ['通用基础','需求与项目','财务费用','杆塔台账','其他扩展']){
  assert.ok(groupLabels.some(text=>text.includes(label)),'missing dictionary group: '+label);
 }
 await workspace.getByRole('button',{name:'新增词条',exact:true}).click();let modal=page.getByRole('dialog',{name:'新增词条',exact:true});
 assert.equal(await modal.getByLabel('编码',{exact:true}).count(),0);assert.equal(await modal.getByLabel('排序',{exact:true}).count(),0);
 await modal.getByRole('button',{name:'保存配置'}).click();await modal.getByText('请填写名称',{exact:true}).waitFor();
 assert.equal(await modal.locator('.el-form-item.is-required').count(),1);
 assert.equal(await modal.locator('.el-form-item.is-required .el-form-item__label').evaluate(node=>getComputedStyle(node,'::before').content),'"*"');
 const errorColor=await modal.locator('.el-form-item__error').evaluate(node=>getComputedStyle(node).color);assert.equal(errorColor,'rgb(220, 56, 74)');
 await modal.getByRole('textbox',{name:'名称',exact:true}).fill('桌面审核电压');await modal.getByRole('button',{name:'保存配置'}).click();await modal.waitFor({state:'hidden'});
 let data=await api('/dictionary-workspace'),created=data.items.find(x=>x.name==='桌面审核电压');assert.match(created.code,/^VL-/);const originalCode=created.code;
 await select(workspace,'字典类型','电压等级');await workspace.getByRole('textbox',{name:'搜索字典'}).fill('桌面审核电压');
 let row=workspace.getByRole('row').filter({hasText:'桌面审核电压'});await row.waitFor();await row.getByRole('button',{name:'编辑',exact:true}).click();modal=page.getByRole('dialog',{name:'编辑词条'});
 await modal.getByRole('textbox',{name:'名称',exact:true}).fill('桌面审核电压修订');await modal.getByRole('button',{name:'保存配置'}).click();await modal.waitFor({state:'hidden'});
 data=await api('/dictionary-workspace');created=data.items.find(x=>x.id===created.id);assert.equal(created.code,originalCode);assert.equal(created.name,'桌面审核电压修订');
 await workspace.getByRole('textbox',{name:'搜索字典'}).fill('桌面审核电压修订');row=workspace.getByRole('row').filter({hasText:'桌面审核电压修订'});await row.locator('.el-checkbox').click();await workspace.getByRole('button',{name:/批量停用/}).click();
 let confirm=page.getByRole('dialog',{name:'停用词条',exact:true});await confirm.getByRole('button',{name:'确认停用'}).click();await confirm.waitFor({state:'hidden'});assert.equal((await api('/dictionary-workspace')).items.find(x=>x.id===created.id).status,'inactive');
 await row.getByRole('button',{name:'启用',exact:true}).click();confirm=page.getByRole('dialog',{name:'启用词条',exact:true});await confirm.getByRole('button',{name:'确认启用'}).click();await confirm.waitFor({state:'hidden'});
 await row.getByRole('button',{name:'上移 桌面审核电压修订',exact:true}).click();await workspace.getByText('显示顺序已更新',{exact:true}).waitFor();
 const ordered=(await api('/voltage-levels'));assert.notEqual(ordered.at(-1).id,created.id);
 const downloadPromise=page.waitForEvent('download');await workspace.getByRole('button',{name:'导出',exact:true}).click();const download=await downloadPromise;
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(readFileSync(await download.path()));assert.equal(workbook.worksheets[0].rowCount,2);assert.equal(workbook.worksheets[0].getCell('B2').value,'桌面审核电压修订');
 await workspace.getByRole('textbox',{name:'搜索字典'}).fill('');await select(workspace,'字典类型','操作类型');await workspace.getByRole('button',{name:'新增词条'}).click();modal=page.getByRole('dialog',{name:'新增词条',exact:true});
 await modal.getByRole('textbox',{name:'名称',exact:true}).fill('桌面审核操作');await modal.getByRole('button',{name:'保存配置'}).click();await modal.getByText('请选择操作类型的计量单位',{exact:true}).waitFor();await select(modal,'计量单位','套');
 await select(modal,'允许的作业位置','档距');await select(modal,'默认作业位置','档距');
 await modal.getByRole('tab',{name:'录入模板',exact:true}).click();await modal.getByRole('textbox',{name:'默认处理部位',exact:true}).fill('导线连接部位');await modal.getByRole('textbox',{name:'默认每项数量',exact:true}).fill('1.5');await modal.getByRole('textbox',{name:'默认完成标准',exact:true}).fill('按核定范围验收');await modal.getByRole('textbox',{name:'录入提示',exact:true}).fill('核对档距两端及本次工作量');
 await modal.getByRole('tab',{name:'影响与预览',exact:true}).click();await modal.getByText('导线连接部位',{exact:false}).first().waitFor();
 for(const width of [1500,1280,960,760]){await page.setViewportSize({width,height:1000});for(const label of ['基本定义','录入模板','附加字段','影响与预览']){await modal.getByRole('tab',{name:label,exact:true}).click();const bad=await modal.evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('button,.el-form-item,.el-tabs__item')].filter(n=>n.getBoundingClientRect().width>0).filter(n=>{const b=n.getBoundingClientRect();return b.left<r.left-2||b.right>r.right+2}).map(n=>n.textContent)});assert.deepEqual(bad,[],width+' '+label);const saveBox=await modal.getByRole('button',{name:'保存配置'}).boundingBox();assert.ok(saveBox&&saveBox.y>=0&&saveBox.y+saveBox.height<=1000);await page.screenshot({path:join(output,'operation-'+width+'-'+['基本定义','录入模板','附加字段','影响与预览'].indexOf(label)+'.png'),animations:'disabled'})}}
 await page.setViewportSize({width:1440,height:1080});
 await modal.getByRole('tab',{name:'附加字段',exact:true}).click();await modal.getByRole('button',{name:'添加业务字段'}).click();await modal.getByRole('textbox',{name:'字段名称',exact:true}).fill('审核相位');await select(modal,'填写方式','下拉选择');await select(modal,'是否必填','必填');
 await modal.getByRole('textbox',{name:'可选内容（每行一个）'}).fill('A\nA');await modal.getByRole('button',{name:'保存配置'}).click();await modal.getByText('可选内容不能重复',{exact:true}).waitFor();
 await modal.getByRole('textbox',{name:'可选内容（每行一个）'}).fill('A\nB');await select(modal,'默认值','A');
 await modal.getByRole('combobox',{name:'默认值',exact:true}).blur();await page.screenshot({path:join(output,'dictionary-operation-editor.png'),animations:'disabled'});
 await modal.getByRole('button',{name:'保存配置'}).click();await modal.waitFor({state:'hidden'});
 const operation=(await api('/dictionary-workspace')).items.find(x=>x.name==='桌面审核操作'),fields=JSON.parse(operation.fields_json);assert.deepEqual(operation.operation_profile.location_kinds,['tower','span']);assert.equal(operation.operation_profile.default_location_kind,'span');assert.equal(operation.operation_profile.default_target_object,'导线连接部位');assert.equal(operation.default_quantity_scaled,15000);assert.equal(fields[0].label,'审核相位');assert.equal(fields[0].required,true);assert.equal(fields[0].default,'A');assert.deepEqual(fields[0].options,['A','B']);assert.match(fields[0].key,/^f[0-9a-f]{32}$/);
 await workspace.getByRole('textbox',{name:'搜索字典'}).fill('桌面审核操作');row=workspace.getByRole('row').filter({hasText:'桌面审核操作'});await row.getByRole('button',{name:'编辑'}).click();modal=page.getByRole('dialog',{name:'编辑词条'});await modal.getByRole('tab',{name:'附加字段',exact:true}).click();await modal.getByRole('textbox',{name:'字段名称'}).fill('相位名称修订');await modal.getByRole('button',{name:'保存配置'}).click();await modal.waitFor({state:'hidden'});
 assert.equal(JSON.parse((await api('/dictionary-workspace')).items.find(x=>x.id===operation.id).fields_json)[0].key,fields[0].key,'editing the label must preserve field identity');
 // Delete a custom entry without references, then verify a configured unit is protected.
 await select(workspace,'字典类型','电压等级');await workspace.getByRole('textbox',{name:'搜索字典'}).fill('桌面审核电压修订');row=workspace.getByRole('row').filter({hasText:'桌面审核电压修订'});
 await row.getByRole('button',{name:'删除',exact:true}).click();let deletionModal=page.getByRole('dialog',{name:'删除词条',exact:true});await deletionModal.getByRole('button',{name:'确认删除'}).click();await deletionModal.waitFor({state:'hidden'});assert.equal((await api('/dictionary-workspace')).items.some(x=>x.id===created.id),false);
 const customUnitResponse=await context.request.post(base+'/api/dictionary-items',{data:{type_id:'unit',name:'删除保护测试单位'}}),customUnit=await customUnitResponse.json();assert.ok(customUnitResponse.ok());
 assert.ok((await context.request.patch(base+'/api/dictionary-items/'+operation.id,{data:{version:2,default_unit_id:customUnit.id}})).ok());
 await navigate(page,'工作台');await navigate(page,'数据字典');await workspace.getByRole('row').filter({hasText:'35kV'}).waitFor();
 await select(workspace,'字典类型','计量单位');await workspace.getByRole('textbox',{name:'搜索字典'}).fill('删除保护测试单位');row=workspace.getByRole('row').filter({hasText:'删除保护测试单位'});await row.getByRole('button',{name:'删除',exact:true}).click();deletionModal=page.getByRole('dialog',{name:'删除词条',exact:true});await deletionModal.getByText('操作单位定义',{exact:true}).waitFor();await deletionModal.getByRole('button',{name:'确认删除'}).click();await deletionModal.waitFor({state:'hidden'});
 let current=await api('/dictionary-workspace');assert.equal(current.items.some(x=>x.id===customUnit.id),false);assert.equal(current.deleted_items.find(x=>x.id===customUnit.id).deletion_kind,'logical');
 await select(workspace,'状态筛选','已删除');await workspace.getByRole('row').filter({hasText:'删除保护测试单位'}).waitFor();
 await select(workspace,'状态筛选','全部状态');await workspace.getByRole('textbox',{name:'搜索字典'}).fill('');await select(workspace,'字典类型','电压等级');
 row=workspace.getByRole('row').filter({hasText:'1000kV'});await row.getByRole('button',{name:'删除',exact:true}).click();deletionModal=page.getByRole('dialog',{name:'删除词条',exact:true});await deletionModal.getByRole('button',{name:'确认删除'}).click();await deletionModal.waitFor({state:'hidden'});
 current=await api('/dictionary-workspace');assert.equal(current.items.some(x=>x.id==='builtin-voltage-AC1000'),false);assert.ok(current.deleted_items.some(x=>x.id==='builtin-voltage-AC1000'));
 assert.deepEqual(errors,[]);console.log('DICTIONARY_BROWSER_OK desktop 1280/1440/1920, Element Plus forms, inline validation, filters, edit, bulk status, ordering, export, visual field templates, fixed application frame and reference-safe deletion');
}finally{await browser?.close();app.close();if(app.listening)await once(app,'close');db.close();rmSync(root,{recursive:true,force:true})}
