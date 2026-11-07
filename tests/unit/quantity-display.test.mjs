import test from 'node:test';
import assert from 'node:assert/strict';
import {quantityScaled,sumQuantities} from '../../web/src/shared/utils/quantity-display.ts';
test('5000-row quantity previews preserve four decimals beyond safe Number aggregate precision',()=>{
 assert.equal(quantityScaled('0.0001'),1n);
 assert.equal(sumQuantities(['0.0001','0.0002']),'0.0003');
 assert.equal(sumQuantities(Array(5000).fill('999999999.9999')),'4999999999999.5');
 assert.equal(sumQuantities(['2套','0','-1','1.00001','2.0001']),'2.0001');
});
