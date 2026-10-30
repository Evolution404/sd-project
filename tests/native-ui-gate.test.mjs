import test from 'node:test';
import assert from 'node:assert/strict';
import {findNativeUi} from '../scripts/check-native-ui.mjs';

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
