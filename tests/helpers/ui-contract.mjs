import assert from 'node:assert/strict';

export async function installUiContractMonitor(page){
 await page.addInitScript(()=>{
  window.__uiContract={dialogs:[],invalid:[]};
  for(const name of ['alert','confirm','prompt'])window[name]=()=>{window.__uiContract.dialogs.push(name);throw Error('UI门禁：禁止原生浏览器业务弹窗 '+name)};
  document.addEventListener('invalid',event=>window.__uiContract.invalid.push(event.target?.getAttribute('aria-label')||event.target?.name||event.target?.tagName),true);
 });
}
export async function assertUiContract(page){
 const result=await page.evaluate(()=>{
  const problems=[],visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0};
  const describe=el=>el.getAttribute('aria-label')||el.name||el.textContent?.trim().slice(0,60)||el.outerHTML.slice(0,130);
  for(const el of document.querySelectorAll('input,textarea,select,button,form,table,dialog,details,progress,meter')){
   if(!visible(el))continue;
   const type=el.getAttribute('type')?.toLowerCase();
   if(el.tagName==='SELECT'||el.tagName==='DIALOG'||el.tagName==='DETAILS'||el.tagName==='PROGRESS'||el.tagName==='METER')problems.push('原生业务控件：'+describe(el));
   if(el.tagName==='INPUT'){
    if(['file','date','datetime-local','time','month','week','color','range'].includes(type))problems.push('可见原生 '+type+' 控件：'+describe(el));
    if(type==='number'&&!el.closest('.el-input-number'))problems.push('原生数字输入：'+describe(el));
    if(!el.closest('.el-input,.el-input-number,.el-checkbox,.el-radio,.el-switch,.el-select,.el-segmented,.el-date-editor'))problems.push('未使用Element Plus的输入框：'+describe(el));
   }
   if(el.tagName==='FORM'&&(!el.classList.contains('el-form')||!el.noValidate))problems.push('表单未统一组件或启用了原生校验：'+describe(el));
   if(el.tagName==='TABLE'&&!el.closest('.el-table,.el-descriptions,.el-picker-panel'))problems.push('原生业务表格：'+describe(el));
   if(el.tagName==='BUTTON'&&!el.closest('.el-button,.el-pagination,.el-picker-panel,.el-input-number,.el-select,.el-dialog,.el-message-box,.el-tabs,.el-collapse,.el-upload,.el-drawer,.el-menu'))problems.push('原生业务按钮：'+describe(el));
   if(el.tagName==='TEXTAREA'&&!el.closest('.el-textarea'))problems.push('原生文本域：'+describe(el));
  }
  for(const message of document.querySelectorAll('.el-message'))if(visible(message)&&getComputedStyle(message).position!=='fixed')problems.push('Element Plus消息样式未生效');
  for(const progress of document.querySelectorAll('.el-progress')){const outer=progress.querySelector('.el-progress-bar__outer');if(visible(progress)&&outer&&getComputedStyle(outer).backgroundColor==='rgba(0, 0, 0, 0)')problems.push('Element Plus进度条样式未生效')}
  return {problems,dialogs:window.__uiContract?.dialogs||[],invalid:window.__uiContract?.invalid||[]};
 });
 assert.deepEqual(result.problems,[],'运行界面不允许出现原生业务控件或缺失样式');
 assert.deepEqual(result.dialogs,[],'不允许浏览器原生业务弹窗');
 assert.deepEqual(result.invalid,[],'不允许浏览器原生表单校验气泡');
}
