import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';
const data=mkdtempSync(join(tmpdir(),'sd-project-browser-'));
let server,browser;const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(url){for(let i=0;i<80;i++){try{if((await fetch(url+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('server startup timeout')}
async function fill(panel,label,text){await panel.getByLabel(label).fill(text)}
async function select(panel,label,value){await panel.getByLabel(label).selectOption({label:value})}
const screenshotPath=join(process.cwd(),'release','browser-acceptance.png');
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,DATA_DIR:data,SD_ADMIN_USER:'browseradmin',SD_ADMIN_PASSWORD:'BrowserSecure123!'}});
 const p=await port(),url='http://127.0.0.1:'+p;
 server=spawn(process.execPath,['server/server.mjs'],{env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PORT:String(p)},stdio:['ignore','pipe','pipe']});
 let err='';server.stderr.on('data',b=>err+=b.toString());
 await wait(url);
 browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-first-run','--no-default-browser-check']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
 await page.goto(url);
 await page.getByLabel('用户名').fill('browseradmin');await page.getByLabel('密码').fill('BrowserSecure123!');
 await page.getByRole('button',{name:'登录系统'}).click();
 await page.getByRole('heading',{name:'工作台'}).waitFor();
 const nav=async title=>{
  const parents={'数据字典':'系统管理','IP访问管理':'系统管理','线路台账':'基础台账','物理杆塔':'基础台账','逻辑杆塔':'基础台账','项目框架':'框架与协议','执行协议':'框架与协议','批量新建需求':'需求中心'};
  const parent=parents[title];
  if(parent&&!await page.locator('.sidebar .nav-submenu').getByRole('button',{name:title,exact:true}).isVisible())await page.locator('.sidebar .nav-primary').filter({hasText:parent}).click();
  if(parent)await page.locator('.sidebar .nav-submenu').getByRole('button',{name:title,exact:true}).click();
  else await page.locator('.sidebar .nav-primary').filter({hasText:title==='子项目储备'?'项目中心':title}).click();
 };
 await nav('数据字典');
 async function addDict(type,code,name,extra={}){
  await page.locator('section.panel').first().getByLabel('类别').selectOption({label:type});
  await page.getByRole('button',{name:'新增选项'}).click();
  const panel=page.locator('.form-panel');await fill(panel,'编码',code);await fill(panel,'名称',name);
  if(extra.kind){await select(panel,'适用对象',extra.kind)}
  if(extra.unit){await select(panel,'默认单位',extra.unit)}
  await panel.getByRole('button',{name:'保存配置'}).click();
  await panel.waitFor({state:'hidden'});
 }
 await addDict('工作单位','SET','套');
 await addDict('来源类型','PATROL','巡视');
 await addDict('操作类型','INSTALL','安装防鸟装置',{unit:'套'});
 await nav('数据字典');
 const masterNav=page.locator('.sidebar .nav-submenu').getByRole('button',{name:'电压等级',exact:true});
 if(await masterNav.count())throw Error('Voltage level must not remain in base ledgers navigation');
 await page.locator('section.panel').first().getByLabel('类别').selectOption({label:'电压等级'});
 await page.getByRole('button',{name:'新增选项'}).click();
 let form=page.locator('.form-panel');await fill(form,'编码','110');await fill(form,'名称','110kV');
 await form.getByRole('button',{name:'保存配置'}).click();await form.waitFor({state:'hidden'});
 await page.getByText('110kV',{exact:true}).waitFor();
 await nav('线路台账');await page.getByRole('button',{name:'新增线路台账'}).click();
 form=page.locator('.form-panel');await fill(form,'线路编码','LTEST');await fill(form,'线路名称','浏览器测试线路');await select(form,'所属电压','110kV');await form.getByRole('button',{name:'保存台账'}).click();await form.waitFor({state:'hidden'});
 await nav('物理杆塔');await page.getByRole('button',{name:'新增物理杆塔'}).click();
 form=page.locator('.form-panel');await fill(form,'实体编码','PH-A');await fill(form,'塔型','角钢塔');await form.getByRole('button',{name:'保存台账'}).click();await form.waitFor({state:'hidden'});
 await nav('逻辑杆塔');
 for(let n=1;n<=2;n++){
  await page.getByRole('button',{name:'新增逻辑杆塔'}).click();form=page.locator('.form-panel');
  await fill(form,'位置编码','LOG-'+n);await fill(form,'杆塔编号','#'+n);await fill(form,'沿线顺序',String(n));
  await select(form,'所属线路','浏览器测试线路');await form.getByLabel('对应物理塔').selectOption({index:1});
  await form.getByRole('button',{name:'保存台账'}).click();await form.waitFor({state:'hidden'});
 }
 await nav('批量新建需求');
 const panels=page.locator('section.panel');
 await panels.nth(0).getByLabel('选择线路').selectOption({label:'110kV · 浏览器测试线路'});
 await panels.nth(0).getByRole('button',{name:'全选本线路'}).click();
 await panels.nth(1).getByLabel('操作类型').selectOption({label:'安装防鸟装置'});
 await fill(panels.nth(1),'共同处理部位','横担');
 await panels.nth(1).locator('.quantity-inputs input').fill('2');
 await panels.nth(1).getByLabel('计量单位').selectOption({label:'套'});
 await fill(panels.nth(1),'完成标准','安装完成验收');
 await fill(panels.nth(1),'问题描述 / 实施必要性','浏览器合成数据核查');
 await panels.nth(2).getByLabel('来源类型').selectOption({label:'巡视'});
 await fill(panels.nth(2),'提出单位 / 人员','浏览器自动测试');
 await panels.nth(2).getByRole('button',{name:'添加一条来源'}).click();
 await panels.nth(2).getByLabel('来源类型').last().selectOption({label:'巡视'});
 await panels.nth(2).getByLabel('提出单位 / 人员').last().fill('附加检查单位');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:join(process.cwd(),'release','entry-ui-acceptance.png'),fullPage:true});
 const desktopOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 if(desktopOverflow)throw Error('Unexpected desktop horizontal scroll');
 await panels.nth(3).getByRole('button',{name:'提交 2 条核实'}).click();
 await page.getByText(/成功创建 2 条待核实需求/).waitFor();
 await nav('需求中心');
 await page.getByText('XQ-0000001').first().waitFor();
 await page.reload();
 await nav('需求中心');
 await page.getByText('XQ-0000002').first().waitFor();
 await page.getByRole('button',{name:'详情'}).first().click();
 await page.getByText('需求 XQ-').first().waitFor();
 await page.locator('.detail-panel').getByRole('button',{name:/关闭/}).click();
 await nav('IP访问管理');
 await page.getByLabel('IP 地址').fill('192.168.45.61');
 await page.getByLabel('设备 / 用途备注').fill('浏览器测试终端');
 await page.getByRole('button',{name:'添加允许 IP'}).click();
 await page.getByText('192.168.45.61').waitFor();
 await page.reload();
 await nav('IP访问管理');
 await page.getByText('192.168.45.61').waitFor();
 await nav('需求中心');
 await page.getByRole('button',{name:'详情'}).first().click();
 page.on('dialog',dialog=>dialog.accept('浏览器核实及阶段审批'));
 await page.getByRole('button',{name:'确认有效'}).click();
 await page.locator('.detail-panel').getByRole('button',{name:/关闭/}).click();
 await nav('项目框架');
 await page.getByRole('button',{name:'新增项目框架'}).click();
 let st=page.locator('.form-panel');
 await fill(st,'业务编码','FW-WEB');await fill(st,'名称','浏览器框架');await fill(st,'授权额度（元）','10000');
 await st.getByRole('button',{name:'保存',exact:true}).click();await st.waitFor({state:'hidden'});
 await nav('执行协议');await page.getByRole('button',{name:'新增执行协议'}).click();
 st=page.locator('.form-panel');await fill(st,'业务编码','AG-WEB');await fill(st,'名称','浏览器协议');await fill(st,'授权额度（元）','5000');
 await st.getByLabel('所属框架').selectOption({label:'浏览器框架'});
 await st.getByRole('button',{name:'保存',exact:true}).click();await st.waitFor({state:'hidden'});
 await nav('子项目储备');await page.getByRole('button',{name:'新增子项目储备'}).click();
 st=page.locator('.form-panel');await fill(st,'业务编码','PJ-WEB');await fill(st,'名称','浏览器子项目');
 await st.getByRole('button',{name:'保存',exact:true}).click();await st.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'需求范围与阶段'}).first().click();
 await page.locator('.detail-panel').getByLabel('纳入有效需求').selectOption({index:1});
 await page.locator('.detail-panel').getByRole('button',{name:'关联需求'}).click();
 await page.locator('.detail-panel').getByRole('button',{name:'确认项目入库'}).click();
 await page.locator('.detail-panel').getByLabel('唯一执行协议').selectOption({label:'浏览器协议 · 浏览器框架'});
 await page.locator('.detail-panel').getByRole('button',{name:'确认协议归属'}).click();
 await page.locator('.detail-panel').getByRole('button',{name:'估价依据'}).first().click();
 await page.locator('.detail-panel').getByLabel('核定单价（元）').fill('123.45');
 await page.locator('.detail-panel').getByLabel('价格依据').fill('浏览器核价记录');
 await page.locator('.detail-panel').getByRole('button',{name:'保存估价'}).click();
 await page.locator('.detail-panel').getByRole('button',{name:'确认立项及预算'}).click();
 await page.locator('.detail-panel').getByText('已立项').first().waitFor();
 await page.locator('.detail-panel').getByRole('button',{name:/关闭/}).click();
 await page.reload();await nav('子项目储备');
 await page.getByText('PJ-WEB').waitFor();
 await page.setViewportSize({width:390,height:844});
 await nav('批量新建需求');
 await page.getByRole('heading',{name:'批量新建需求'}).waitFor();
 const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 if(mobileOverflow)throw Error('Unexpected mobile horizontal overflow');
 await page.screenshot({path:join(process.cwd(),'release','entry-mobile-acceptance.png'),fullPage:false});
 await page.setViewportSize({width:1440,height:1000});
 await nav('子项目储备');
 await page.screenshot({path:screenshotPath,fullPage:true});
 const api=await page.evaluate(async()=>await(await fetch('/api/demands')).json());
 if(api.length!==2)throw Error('Expected two persisted browser demand records, got '+api.length);
 const firstDetail=await page.evaluate(async id=>await(await fetch('/api/demands/'+id)).json(),api[0].id);
 if(firstDetail.sources.length!==2)throw Error('Expected two separately persisted source records');
 console.log('BROWSER_MULTI_SOURCES_OK',firstDetail.sources.map(x=>x.proposed_by).join(', '));
 console.log('BROWSER_ACCEPTED Chrome UI login, dictionaries, tower, 2 demands, IP allowlist, framework, agreement, project stocked and approved, refresh persistence');
 console.log('SCREENSHOT',screenshotPath);
 console.log('ERROR_LOG',err||'(empty)');
}finally{
 if(browser)await browser.close();
 if(server){server.kill('SIGTERM');await sleep(150)}
 rmSync(data,{recursive:true,force:true});
}
