import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
/**
 * Real-Chrome full-workspace detail inspection. Rows in data tables are
 * intentionally scrollable; business page headings/actions must stay in-flow.
 */
export async function auditDetail(page, selector, key, widths=[1500,1280,960,760]){
 mkdirSync('test-results/ui-deep-audit',{recursive:true});
 const report=[];
 for(const width of widths){
  await page.setViewportSize({width,height:900});
  const root=page.locator(selector);await root.waitFor({state:'visible'});
  await root.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const result=await root.evaluate((el)=>{
   const rect=el.getBoundingClientRect(),viewport=innerWidth;
   const main=document.querySelector('.application-scroll')?.getBoundingClientRect();
   const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
   const issues=[...el.querySelectorAll('h2,h3,button,.el-select,.el-input,.info-grid>div,.demand-detail-metrics>div,.tower-detail-metrics .el-card')].filter(visible).flatMap(e=>{
     const b=e.getBoundingClientRect();
     const inScroll=!!e.closest('.el-table,.table-wrap,.el-tabs__nav-wrap,.scope-item[style],.el-pagination');
     return inScroll?[]:b.left<(main?.left??0)-4||b.right>(main?.right??viewport)+4
      ?[{element:e.tagName,className:String(e.className).slice(0,90),text:e.textContent?.trim().slice(0,36),left:Math.round(b.left),right:Math.round(b.right)}]:[];
   });
   return {width:viewport,documentWidth:document.documentElement.scrollWidth,
    position:getComputedStyle(el).position,rootLeft:Math.round(rect.left),rootRight:Math.round(rect.right),
    mainLeft:Math.round(main?.left??0),mainRight:Math.round(main?.right??viewport),
    visibleHeadings:[...el.querySelectorAll('h2,h3')].filter(visible).length,
    issues};
  });
  await page.screenshot({path:'test-results/ui-deep-audit/'+key+'-'+width+'.png'});
  report.push(result);
  console.log('DEEP_UI',key,JSON.stringify(result));
  assert.equal(result.position,'static',key+' detail may not be fixed/overlay');
  assert.ok(result.documentWidth<=width+1,key+' must not overflow document at '+width);
  assert.ok(result.rootLeft>=result.mainLeft-2&&result.rootRight<=result.mainRight+2,key+' must remain in main content at '+width);
  assert.deepEqual(result.issues,[],key+' controls/cards clipped at '+width);
 }
 return report;
}
