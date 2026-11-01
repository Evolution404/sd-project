import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {navigate} from './browser-navigation.mjs';
const root=mkdtempSync(join(tmpdir(),'sd-topology-labels-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs'),{app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'labels',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1760,height:1000}});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 async function api(path,method='GET',data){
  const r=await context.request.fetch(origin+'/api'+path,{method,data});
  assert.ok(r.ok(),path+': '+await r.text());return r.json();
 }
 await api('/auth/login','POST',{username:'labels',password:'test'});
 const v=await api('/voltage-levels','POST',{code:'500',name:'500kV'});
 const l=await api('/ledger/lines','POST',{name:'三秋5631线',voltage_level_id:v.id});
 let w=await api('/ledger/lines/'+l.id);
 const towerNos=['500kV三秋5631线001','500kV三秋5631线002','500kV三秋5631线003','500kV三秋5631线004'];
 await api('/ledger/lines/'+l.id+'/towers','POST',{version:w.line.version,topology_token:w.topology_token,rows:towerNos.map(tower_no=>({tower_no}))});
 await page.goto(origin);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await navigate(page,'线路台账');
 await page.locator('.ledger-directory .ledger-line').filter({hasText:'三秋5631线'}).click();
 const editor=page.locator('.topology-workspace');await editor.waitFor();
 const canvas=editor.locator('svg.topology-canvas');
 if(!process.env.BEFORE)await page.screenshot({path:join(process.cwd(),'release','topology-labels-overview.png'),fullPage:false});
 await editor.getByRole('button',{name:'放大拓扑'}).click();
 await editor.getByRole('button',{name:'放大拓扑'}).click();
 await editor.getByRole('button',{name:'放大拓扑'}).click();
 await page.screenshot({path:join(process.cwd(),'release',process.env.BEFORE?'topology-labels-before.png':'topology-labels-after.png'),fullPage:false});
 const state=await canvas.evaluate(svg=>{
  const nodes=[...svg.querySelectorAll('.topology-node')];
  const items=nodes.map(n=>{const t=n.querySelector('text');if(!t)return null;const r=t.getBoundingClientRect();return {label:t.textContent,pxFont:getComputedStyle(t).fontSize,width:r.width,height:r.height,x:r.x,y:r.y}}).filter(Boolean);
  let overlaps=0;
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
   const a=items[i],b=items[j];
   if(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height)overlaps++;
  }
  const diameters=nodes.map(n=>n.querySelector('circle')?.getBoundingClientRect().width).filter(Boolean);
  return {items,overlaps,diameters};
 });
 console.log('TOPOLOGY_LABEL_GEOMETRY',JSON.stringify(state));
 if(!process.env.BEFORE){
  assert.equal(state.overlaps,0,'tower labels must not overlap');
  assert.ok(state.items.every(t=>t.height<22),'SVG labels must remain a readable pixel size when zoomed');
  assert.ok(state.items.every(t=>!t.label.includes('三秋5631线')),'show short tower numbers, not repeated whole line names');
  assert.ok(state.diameters.every(d=>d<=37),'tower circles should retain constant visual size while zooming');
  for(let i=0;i<5;i++)await editor.getByRole('button',{name:'缩小拓扑'}).click();
  const out=await canvas.evaluate(svg=>{
   const labels=[...svg.querySelectorAll('.topology-label')].map(t=>t.getBoundingClientRect());
   let count=0;
   for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const a=labels[i],b=labels[j];
    if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)count++;
   }
   return {overlaps:count,maxLabelHeight:Math.max(0,...labels.map(b=>b.height)),labels:labels.length};
  });
  assert.equal(out.overlaps,0,'labels must not overlap after zooming far out');
  assert.ok(out.maxLabelHeight<=22,'labels must not enlarge at any zoom');
  console.log('TOPOLOGY_LABEL_ZOOM_OUT',JSON.stringify(out));
  for(const width of [1280,960,760]){
   await page.setViewportSize({width,height:950});
   await canvas.scrollIntoViewIfNeeded();
   await page.waitForTimeout(80);
   const visible=await canvas.evaluate(svg=>{
    const labels=[...svg.querySelectorAll('.topology-label')].map(e=>e.getBoundingClientRect());
    let overlaps=0;
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
     const a=labels[i],b=labels[j];
     if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)overlaps++;
    }
    return {overlaps,maxHeight:Math.max(0,...labels.map(e=>e.height))};
   });
   assert.equal(visible.overlaps,0,'labels must not overlap at '+width+'px');
   assert.ok(visible.maxHeight<=22,'font must remain stable at '+width+'px');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width+'px');
  }
 }
}finally{if(browser)await browser.close();await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})}
