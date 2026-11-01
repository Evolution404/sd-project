import {test} from 'node:test';
import assert from 'node:assert/strict';
import {descriptionColumnCount} from '../web/src/utils/responsive-descriptions.ts';
test('descriptions reflow rather than squeezing three summary groups into 760px',()=>{
 for(const desktop of [2,3]){
  assert.equal(descriptionColumnCount(760,desktop),1);
  assert.equal(descriptionColumnCount(960,desktop),2);
  assert.equal(descriptionColumnCount(1280,desktop),2);
  assert.equal(descriptionColumnCount(1500,desktop),desktop);
 }
});
