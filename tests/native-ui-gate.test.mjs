import test from 'node:test';
import assert from 'node:assert/strict';
import {findNativeUi} from '../scripts/check-native-ui.mjs';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

test('native-ui audit counts only real Vue native interactive template nodes',()=>{
 const template=`<script setup>const sample='<button>not a real control</button>';</script>
 <template><div><button>one</button><ElButton>safe</ElButton>
 <ElForm><ElFormItem><input/></ElFormItem></ElForm><form><select><option>one</option></select></form>
 <table><tr><td>value</td></tr></table><div><details><summary>more</summary></details></div>
 </div></template>`;
 assert.deepEqual({...findNativeUi(template)},{
  button:1,input:1,form:1,select:1,table:1,details:1,summary:1
 });
});

test('native-ui audit ignores element-plus component names and plain layout tags',()=>{
 const template=`<template><ElDialog><ElForm><ElInput/><ElSelect/><ElTable/><ElButton/></ElForm></ElDialog><section><div><label>name</label></div></section></template>`;
 assert.equal(Object.keys(findNativeUi(template)).length,0);
});


test('G7: Vue sources have no obsolete DOM validation directive or homemade dialog',()=>{
 const root=resolve(fileURLToPath(new URL('../web/src/',import.meta.url)));
 const scan=(dir)=>{
  for(const item of readdirSync(dir,{withFileTypes:true})){
   const path=join(dir,item.name);
   if(item.isDirectory())scan(path);
   else if(item.name.endsWith('.vue')){
    const source=readFileSync(path,'utf8');
    assert.doesNotMatch(source,/v-form-validation|vFormValidation/,path);
   }
  }
 };
 scan(root);
 assert.equal(existsSync(join(root,'utils/form-validation.ts')),false);
 assert.equal(existsSync(join(root,'components/FormModal.vue')),false);
});


test('details are first-class in-flow pages, never drawer or fixed side overlay',()=>{
 const base=resolve(fileURLToPath(new URL('../web/src/',import.meta.url)));
 const ledger=readFileSync(join(base,'components/LedgerWorkspace.vue'),'utf8');
 const tower=readFileSync(join(base,'components/LedgerTowerDetail.vue'),'utf8');
 const app=readFileSync(join(base,'App.vue'),'utf8');
 const stylesheet=readFileSync(join(base,'style.css'),'utf8');
 assert.doesNotMatch(ledger,/<ElDrawer\b|ElDrawer\b/);
 assert.doesNotMatch(app,/detail-overlay/);
 assert.doesNotMatch(stylesheet,/\.detail-overlay\s*\{/);
 assert.match(ledger,/<LedgerTowerDetail\b/);
 assert.match(tower,/<ElTabs\b/);
 assert.match(app,/class="demand-detail-page"/);
 assert.match(app,/class="business-detail-page/);
});
