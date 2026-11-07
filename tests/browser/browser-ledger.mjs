import {selectUiOption,assertSearchableUiSelect} from '../helpers/select-ui-option.mjs';
import {navigate} from './browser-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const root=mkdtempSync(join(tmpdir(),'sd-ledger-ui-'));process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';const {db}=await import('../../server/database/index.mjs');const {app}=await import('../../server/main.mjs');let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'ledger-ui',SD_ADMIN_PASSWORD:'test'}});app.listen(0,'127.0.0.1');await once(app,'listening');const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function api(path,method='GET',data){const r=await context.request.fetch(origin+'/api'+path,{method,data});assert.ok(r.ok(),path+': '+await r.text());return r.json()}
 await api('/auth/login','POST',{username:'ledger-ui',password:'test'});const v=await api('/voltage-levels','POST',{code:'110',name:'110kV'});const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'M',name:'米'});const op=await api('/dictionary-items','POST',{type_id:'operation',operation_profile:{location_kinds:['span'],default_location_kind:'span',default_target_object:'',entry_hint:''},default_unit_id:unit.id,code:'CLEAR',name:'清理通道',work_target_type:'line'});await api('/dictionary-items','POST',{type_id:'source',code:'SITE',name:'现场发现'});
 await page.goto(origin);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 async function arrowPosition(button){return button.evaluate(async el=>{const icon=el.querySelector('.el-sub-menu__icon-arrow'),svg=icon.querySelector('svg');getComputedStyle(icon).transform;await Promise.all(icon.getAnimations().map(animation=>animation.finished));const button=el.getBoundingClientRect(),box=icon.getBoundingClientRect(),path=svg.querySelector('path').getBoundingClientRect();return {x:box.x+box.width/2-button.x,y:box.y+box.height/2-button.y,graphicX:path.x+path.width/2-button.x,graphicY:path.y+path.height/2-button.y,height:button.height}})}
 for(const label of ['框架与协议','系统管理','基础台账']){const button=page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:label});if(await button.locator('..').getAttribute('aria-expanded')==='true')await button.click();const closed=await arrowPosition(button);await button.click();assert.equal(await button.locator('..').getAttribute('aria-expanded'),'true');const opened=await arrowPosition(button);for(const key of ['x','y','graphicX','graphicY'])assert.ok(Math.abs(closed[key]-opened[key])<(key.startsWith('graphic')?0.5:0.1),label+' arrow shifted: '+JSON.stringify({closed,opened}));assert.ok(Math.abs(opened.y-opened.height/2)<0.1);await button.click();assert.equal(await button.locator('..').getAttribute('aria-expanded'),'false');}
 await navigate(page,'线路台账');

 const selectLine=async name=>{await page.locator('.ledger-directory .ledger-line').filter({hasText:name}).click();await page.locator('.ledger-summary').getByRole('heading',{name,exact:true}).waitFor()};
 const tab=async name=>page.locator('.ledger-tabs').getByRole('button',{name,exact:true}).click();
 async function createLine(name){await page.getByRole('button',{name:'新建线路',exact:true}).click();const d=page.getByRole('dialog',{name:'新建线路'});assert.equal(await d.getByLabel('班组',{exact:true}).count(),0);assert.equal(await d.getByLabel('架设方式',{exact:true}).count(),0);await d.getByLabel('线路名称',{exact:true}).fill(name);await selectUiOption(d.getByLabel('电压等级',{exact:true}),v.id);await d.getByRole('button',{name:'保存线路',exact:true}).click();await d.waitFor({state:'hidden'});await page.locator('.ledger-summary').getByRole('heading',{name,exact:true}).waitFor()}
 assert.equal(await page.getByLabel('班组筛选',{exact:true}).count(),0);const dictionaryTypes=await api('/dictionary-types');assert.equal(dictionaryTypes.some(t=>['team','erection'].includes(t.id)),false);
 await createLine('主线甲');
 assert.deepEqual(await page.locator('.ledger-tabs button').allInnerTexts(),['杆塔清单','档距清单','拓扑编辑','线路信息','变更记录'],'line ledger tab order');
 assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'杆塔清单','first tab must be selected on initial entry');
 // Element Plus buttons use an inline-flex inner span: verify actual two-line geometry.
 for(const width of [1500,1280,960,760]){
  await page.setViewportSize({width,height:950});
  const layout=await page.locator('.ledger-directory .ledger-line.selected').evaluate(button=>{
   const title=button.querySelector('.ledger-line-title'),meta=button.querySelector('.ledger-line-meta');
   const a=title.getBoundingClientRect(),b=meta.getBoundingClientRect();
   return {buttonX:button.getBoundingClientRect().left,titleX:a.left,metaX:b.left,titleBottom:a.bottom,metaTop:b.top,metaText:meta.textContent?.trim(),titleText:title.textContent?.trim(),buttonScroll:button.scrollWidth,buttonWidth:button.clientWidth};
  });
  assert.ok(Math.abs(layout.titleX-layout.metaX)<=1,'directory title and metadata alignment '+width+': '+JSON.stringify(layout));
  assert.ok(layout.titleX-layout.buttonX>=10&&layout.titleX-layout.buttonX<=16,'directory text must align with card left inset '+width+': '+JSON.stringify(layout));
  assert.ok(layout.metaTop>=layout.titleBottom+3,'directory must have two lines with spacing '+width+': '+JSON.stringify(layout));
  assert.ok(!layout.metaText.includes('主线')&&!layout.metaText.includes('支线'),'directory metadata must not repeat line type');
  assert.ok(layout.buttonScroll<=layout.buttonWidth+2,'directory must not overflow '+width);
  mkdirSync('test-results/ui-spacing',{recursive:true});
  await page.locator('.el-overlay:visible').first().waitFor({state:'hidden'});
  await page.locator('.ledger-directory').screenshot({path:join(process.cwd(),'test-results/ui-spacing/line-directory-'+width+'.png')});
 }
 await page.setViewportSize({width:1500,height:1000});
 await page.locator('.ledger-tabs').getByRole('button',{name:'拓扑编辑',exact:true}).click();
 await page.locator('.topology-workspace').waitFor({timeout:12000});
 assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'拓扑编辑','manually selected tab remains active');
 await navigate(page,'工作台');await navigate(page,'线路台账');
 await page.locator('.ledger-summary').getByRole('heading',{name:'主线甲',exact:true}).waitFor();
 assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'杆塔清单','returning via menu resets to the first tab');
 await page.locator('.ledger-tabs').getByRole('button',{name:'杆塔清单',exact:true}).click();await page.getByRole('button',{name:'新增支线',exact:true}).click();let d=page.getByRole('dialog',{name:'新建线路'});await assertSearchableUiSelect(d.getByLabel('所属主线',{exact:true}),'主线甲','主线甲');await d.getByLabel('线路名称',{exact:true}).fill('甲线支线');await d.getByRole('button',{name:'保存支线草稿',exact:true}).click();await d.waitFor({state:'hidden'});await page.getByText('支线接入点待确认。',{exact:false}).waitFor();await selectLine('主线甲');
 const branchLayout=await page.locator('.ledger-directory .ledger-line.branch').first().evaluate(button=>{
  const title=button.querySelector('.ledger-line-title').getBoundingClientRect(),meta=button.querySelector('.ledger-line-meta').getBoundingClientRect();
  return {aligned:Math.abs(title.left-meta.left)<1,spaced:meta.top>=title.bottom+3,inset:title.left-button.getBoundingClientRect().left,meta:button.querySelector('.ledger-line-meta').textContent};
 });
 assert.ok(branchLayout.aligned&&branchLayout.spaced,'branch directory uses the same two-line alignment');
 assert.ok(branchLayout.inset>=22&&branchLayout.inset<=28,'branch must use a consistent 24px hierarchy inset: '+JSON.stringify(branchLayout));
 await page.locator('.ledger-directory').screenshot({path:join(process.cwd(),'test-results/ui-spacing/line-directory-branches-1500.png')});
 assert.ok(!branchLayout.meta.includes('支线'),'branch metadata does not repeat line type');
 await page.getByRole('button',{name:'批量添加杆塔',exact:true}).click();d=page.getByRole('dialog',{name:'批量添加杆塔'});await d.getByLabel('编号起点',{exact:true}).fill('1');await d.getByLabel('编号终点',{exact:true}).fill('3');await d.getByLabel('结构类型',{exact:true}).fill('角钢塔');await d.getByLabel('型号',{exact:true}).fill('MODEL-A');await d.getByRole('button',{name:'生成逐基预览',exact:true}).click();await d.getByLabel('杆塔号 2',{exact:true}).fill('001A');await d.getByLabel('型号',{exact:true}).fill('MODEL-B');await d.getByRole('button',{name:'共同属性仅填空值',exact:true}).click();assert.equal(await d.getByLabel('型号 1',{exact:true}).inputValue(),'MODEL-A');await d.getByLabel('应用共同属性 1',{exact:true}).uncheck();await d.getByLabel('应用共同属性 3',{exact:true}).uncheck();await d.getByRole('button',{name:'共同属性覆盖勾选行',exact:true}).click();assert.equal(await d.getByLabel('型号 2',{exact:true}).inputValue(),'MODEL-B');await d.getByRole('button',{name:'预检并继续',exact:true}).click();await d.getByRole('button',{name:'确认保存 3 基',exact:true}).click();await d.waitFor({state:'hidden'});
 let ls=await api('/ledger/lines'),main=ls.find(l=>l.name==='主线甲'),branch=ls.find(l=>l.name==='甲线支线'),w=await api('/ledger/lines/'+main.id);assert.deepEqual(w.towers.map(t=>t.tower_no),['001','001A','003']);assert.equal(w.towers[1].model,'MODEL-B');
 await tab('档距清单');await page.getByRole('button',{name:'按杆塔顺序生成',exact:true}).click();d=page.getByRole('dialog',{name:'按杆塔顺序生成档距'});await d.getByRole('button',{name:'确认建立 2 档',exact:true}).click();await d.waitFor({state:'hidden'});w=await api('/ledger/lines/'+main.id);assert.equal(w.spans.filter(s=>s.status==='active').length,2);assert.equal(w.spans[0].length_scaled,null);
 const ledgerTheme=await page.evaluate(()=>{
  const css=selector=>{
   const el=document.querySelector(selector);
   if(!el)throw Error('Missing ledger theme element: '+selector);
   const v=getComputedStyle(el);
   return {background:v.backgroundColor,color:v.color,border:v.borderTopColor};
  };
  return {selected:css('.ledger-directory .ledger-line.selected'),tab:css('.ledger-tabs .el-button.active'),badge:css('.ledger-summary .el-tag'),canvas:css('.application-scroll'),buttons:[...document.querySelectorAll('.ledger-main .el-button.secondary')].slice(0,2).map(el=>({color:getComputedStyle(el).color,border:getComputedStyle(el).borderTopColor}))};
 });
 console.log('LEDGER_BLUE_THEME',JSON.stringify(ledgerTheme));
 assert.equal(ledgerTheme.selected.background,'rgb(234, 242, 255)','selected line must use blue highlight');
 assert.equal(ledgerTheme.selected.color,'rgb(36, 99, 213)','selected line name must use blue, not green');
 assert.equal(ledgerTheme.tab.color,'rgb(52, 120, 246)','active tab must use primary blue');
 assert.equal(ledgerTheme.badge.color.includes('green'),false);
 for(const color of [ledgerTheme.selected.background,ledgerTheme.selected.color,ledgerTheme.tab.background,ledgerTheme.tab.color]){
  assert.ok(!['rgb(231, 241, 233)','rgb(33, 93, 69)','rgb(229, 240, 232)','rgb(24, 82, 57)'].includes(color),'obsolete green palette remains: '+color);
 }
 await page.locator('.el-overlay:visible').first().waitFor({state:'hidden',timeout:6000});
 assert.equal(await page.locator('.el-overlay:visible').count(),0,'Theme screenshot must not contain a closing dialog overlay');
 mkdirSync('test-results',{recursive:true});
 await page.screenshot({path:join(process.cwd(),'test-results','ledger-spans-blue-theme.png'),fullPage:false});

 const countBefore=await api('/physical-towers');await selectLine('甲线支线');await page.getByRole('button',{name:'编辑线路',exact:true}).click();d=page.getByRole('dialog',{name:'编辑线路'});await assertSearchableUiSelect(d.getByLabel('接入杆塔',{exact:true}),'001A','001A');await selectUiOption(d.getByLabel('接入杆塔',{exact:true}),w.towers[1].id);await d.getByLabel('变更原因',{exact:true}).fill('确认支线接入主线001A');await d.getByRole('button',{name:'保存线路',exact:true}).click();await d.waitFor({state:'hidden'});assert.equal((await api('/physical-towers')).length,countBefore.length);
 await tab('杆塔清单');await page.getByRole('button',{name:'新增杆塔',exact:true}).click();d=page.getByRole('dialog',{name:'新增杆塔'});await d.getByLabel('杆塔号 1',{exact:true}).fill('001');await d.getByRole('button',{name:'保存杆塔',exact:true}).click();await d.waitFor({state:'hidden'});await tab('档距清单');await page.getByRole('button',{name:'按杆塔顺序生成',exact:true}).click();d=page.getByRole('dialog',{name:'按杆塔顺序生成档距'});await d.getByRole('button',{name:'确认建立 1 档',exact:true}).click();await d.waitFor({state:'hidden'});
 await createLine('主线乙');await tab('杆塔清单');await page.getByRole('button',{name:'新增杆塔',exact:true}).click();d=page.getByRole('dialog',{name:'新增杆塔'});await d.getByLabel('杆塔号 1',{exact:true}).fill('028');await selectUiOption(d.getByLabel('实际杆塔',{exact:true}),'existing');await assertSearchableUiSelect(d.getByLabel('查找已有杆塔的线路',{exact:true}),'主线甲','主线甲');await selectUiOption(d.getByLabel('查找已有杆塔的线路',{exact:true}),main.id);await assertSearchableUiSelect(d.getByLabel('关联已有杆塔 1',{exact:true}),'001','001');await selectUiOption(d.getByLabel('关联已有杆塔 1',{exact:true}),w.towers[0].physical_tower_id);await d.getByRole('button',{name:'保存杆塔',exact:true}).click();await d.waitFor({state:'hidden'});ls=await api('/ledger/lines');const other=ls.find(l=>l.name==='主线乙');let ow=await api('/ledger/lines/'+other.id);assert.equal(ow.towers[0].physical_tower_id,w.towers[0].physical_tower_id);
 await page.locator('.ledger-main tbody').getByRole('button',{name:'编辑',exact:true}).click();d=page.getByRole('dialog',{name:'编辑杆塔'});await d.getByLabel('管辖部门',{exact:true}).fill('输电运检班');await d.getByLabel('型号',{exact:true}).fill('共享修正型号');await d.getByLabel('变更原因',{exact:true}).fill('核对共塔型号');await d.getByRole('button',{name:'保存杆塔变更',exact:true}).click();assert.equal(await d.isVisible(),true,'未确认跨线路公共属性影响时不得关闭编辑表单');await d.getByLabel('确认共同属性修改影响',{exact:true}).check();await d.getByRole('button',{name:'保存杆塔变更',exact:true}).click();await d.waitFor({state:'hidden'});await page.getByRole('button',{name:'关闭杆塔详情'}).click();assert.equal((await api('/ledger/lines/'+main.id)).towers[0].model,'共享修正型号');
 await selectLine('主线甲');await tab('杆塔清单');const firstRow=page.locator('.ledger-main tbody tr').filter({has:page.locator('td:nth-child(3)').getByRole('button',{name:'001',exact:true})});await firstRow.getByRole('button',{name:'001',exact:true}).click();
 const towerDetailPage=page.locator('.ledger-main .tower-detail-page');
 await towerDetailPage.waitFor();
 assert.equal(await towerDetailPage.getByRole('tab',{name:/基础信息/}).getAttribute('aria-selected'),'true','tower detail defaults to its first tab');
 await towerDetailPage.getByRole('button',{name:'关联共塔',exact:true}).click();
 d=page.getByRole('dialog',{name:'关联共塔'});
 await d.waitFor();
 await assertSearchableUiSelect(d.getByLabel('目标线路筛选',{exact:true}),'主线乙','主线乙');
 await d.getByRole('button',{name:'取消',exact:true}).click();
 await d.waitFor({state:'hidden'});
 await page.locator('.el-overlay:visible').first().waitFor({state:'hidden'});
 assert.equal(await page.locator('.el-drawer:visible,.el-overlay:visible').count(),0,'杆塔详情不得使用抽屉或遮罩');
 assert.equal(await towerDetailPage.evaluate(el=>getComputedStyle(el).position),'static','杆塔详情必须是主区域正常文档流');
 assert.ok(await towerDetailPage.getByRole('tab',{name:/基础信息/}).isVisible());
 assert.ok(await towerDetailPage.getByRole('tab',{name:/关联线路/}).isVisible());
 assert.ok(await towerDetailPage.getByRole('tab',{name:/相邻档距/}).isVisible());
 assert.ok(await towerDetailPage.getByRole('tab',{name:/变更历史/}).isVisible());
 for(const width of [1500,1280,960,760]){
  await page.setViewportSize({width,height:950});
  await towerDetailPage.scrollIntoViewIfNeeded();
  const cellPadding=await towerDetailPage.locator('.el-descriptions__table.is-bordered .el-descriptions__cell').evaluateAll(cells=>cells.slice(0,8).map(cell=>({left:parseFloat(getComputedStyle(cell).paddingLeft),right:parseFloat(getComputedStyle(cell).paddingRight)})));
  assert.ok(cellPadding.length>=2&&cellPadding.every(cell=>cell.left>=15&&cell.right>=15),'detail descriptions must have 16px horizontal inset at '+width+': '+JSON.stringify(cellPadding));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'杆塔详情宽度 '+width+' 不得横向溢出');
  assert.ok(await towerDetailPage.evaluate(el=>el.getBoundingClientRect().width>200),'杆塔详情应占有可见主页面宽度');
  mkdirSync('test-results',{recursive:true});
  await page.screenshot({path:join(process.cwd(),'test-results','tower-detail-'+width+'.png'),fullPage:false});
  if(width===760){
   const summaryCells=await towerDetailPage.locator('.el-descriptions__table tbody tr').first().locator('th,td').count();
   assert.equal(summaryCells,2,'tower fact sheet must use one label/value pair at 760px');
  }
 }
 await page.setViewportSize({width:1500,height:1000});
 await towerDetailPage.getByRole('tab',{name:/关联线路/}).click();
 await towerDetailPage.getByText('主线甲').first().waitFor();
 await towerDetailPage.getByRole('tab',{name:/相邻档距/}).click();
 await towerDetailPage.getByRole('tab',{name:/变更历史/}).click();
 await towerDetailPage.getByRole('tab',{name:/基础信息/}).click();
 await page.getByRole('button',{name:'后插入',exact:true}).click();d=page.getByRole('dialog',{name:'新增杆塔'});await d.getByLabel('杆塔号 1',{exact:true}).fill('002');await d.getByRole('button',{name:'保存杆塔',exact:true}).click();await d.waitFor({state:'hidden'});w=await api('/ledger/lines/'+main.id);assert.deepEqual(w.towers.map(t=>t.tower_no),['001','002','001A','003']);const inserted=w.towers.find(t=>t.tower_no==='002');await tab('档距清单');await page.getByLabel('选择档距 001—001A',{exact:true}).check();await page.getByRole('button',{name:'拆档 / 合档',exact:true}).click();d=page.getByRole('dialog',{name:'拆档 / 合档变更'});await selectUiOption(d.getByLabel('插入杆塔 1',{exact:true}),inserted.id);await d.getByRole('button',{name:'在此杆塔拆为两档',exact:true}).click();await d.getByLabel('拆档 / 合档依据',{exact:true}).fill('新增002后拆档');await d.getByRole('button',{name:'确认档距变更',exact:true}).click();await d.waitFor({state:'hidden'});w=await api('/ledger/lines/'+main.id);assert.equal(w.spans.filter(s=>s.status==='retired').length,1);
 await page.getByLabel('选择档距 001—002',{exact:true}).check();await page.getByRole('button',{name:'按所选档距新建需求',exact:true}).click();await page.getByText('当前按档距创建需求',{exact:true}).waitFor();const panels=page.locator('section.entry-section');assert.equal(await panels.nth(1).getByLabel('每档工作量').inputValue(),'1','span length must not auto-become work quantity');await selectUiOption(panels.nth(0).getByLabel('操作类型',{exact:true}),op.id);await panels.nth(1).getByLabel('共同处理部位').fill('通道');await panels.nth(1).getByLabel('每档工作量').fill('10');assert.equal(await panels.nth(1).getByLabel('计量单位').getAttribute('readonly')!==null,true);await panels.nth(1).getByLabel('完成标准').fill('验收');await panels.nth(1).getByLabel('问题描述').fill('现场树障');await selectUiOption(panels.nth(2).getByLabel('来源类型'),{label:'现场发现'});await panels.nth(2).getByLabel('提出单位 / 人员').fill('测试班组');await page.getByRole('dialog',{name:'添加一组需求',exact:true}).getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('草稿已保存',{exact:true}).first().waitFor();await page.reload();await page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:'需求中心'}).click();await page.locator('.sidebar').getByRole('menuitem',{name:'新建需求',exact:true}).click();await page.getByRole('button',{name:/查看草稿/}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();await page.getByRole('dialog',{name:'需求草稿',exact:true}).waitFor({state:'hidden'});await page.locator('.demand-batch-workspace tbody tr').getByRole('button',{name:'编辑',exact:true}).click();const rowModal=page.getByRole('dialog',{name:/编辑需求/});assert.equal(await rowModal.getByLabel('工作量',{exact:true}).inputValue(),'10');await rowModal.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'提交 1 条核实',exact:true}).click();await page.getByRole('button',{name:'确认提交核实',exact:true}).click();await page.getByRole('status').filter({hasText:'新建 1 条'}).first().waitFor();const ds=await api('/demands');const demand=await api('/demands/'+ds[0].id);assert.equal('length_scaled' in demand.span_snapshot,false);assert.equal(demand.quantity_scaled,100000);
 await page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:'基础台账'}).click();await page.locator('.sidebar').getByRole('menuitem',{name:'杆塔查询',exact:true}).click();await assertSearchableUiSelect(page.getByRole('combobox',{name:'线路筛选',exact:true}),'主线甲','主线甲');await page.getByLabel('查询关键词',{exact:true}).fill('002');await page.getByRole('button',{name:'在线路中查看',exact:true}).first().click();await page.getByRole('button',{name:'关闭杆塔详情'}).click();assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'杆塔清单');await page.locator('.sidebar').getByRole('menuitem',{name:'档距查询',exact:true}).click();await page.getByLabel('查询关键词',{exact:true}).fill('002');await page.getByRole('button',{name:'在线路中查看',exact:true}).first().click();assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'档距清单');await selectLine('主线甲');await tab('档距清单');mkdirSync('test-results',{recursive:true});await page.screenshot({path:join(process.cwd(),'test-results','ledger-workspace.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.setViewportSize({width:1280,height:900});await page.locator('.ledger-summary').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.cwd(),'test-results','ledger-desktop-1280.png'),fullPage:false});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);console.log('LEDGER_BROWSER_OK fixed sidebar arrow centers; simplified line fields; main/branch junction; batch preview/default overrides; shared physical editing; insert/split history; span-linked demands; desktop');
}finally{if(browser)await browser.close();await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})}
