import test from 'node:test';
import assert from 'node:assert/strict';
import {topologyTowerLabel,estimateTowerLabelWidth} from '../../web/src/shared/utils/topology-labels.ts';
test('topology label displays the tower number rather than repeating the full imported line name',()=>{
 assert.equal(topologyTowerLabel('500kV三秋5631线001','三秋5631线'),'001');
 assert.equal(topologyTowerLabel('500kV三秋5631线001A','三秋5631线'),'001A');
 assert.equal(topologyTowerLabel('三秋5631线015+1','三秋5631线'),'015+1');
 assert.equal(topologyTowerLabel('#023','三秋5631线'),'#023');
 assert.equal(topologyTowerLabel('001','三秋5631线'),'001');
 assert.equal(topologyTowerLabel('A区特殊杆塔001','其他线'),'001');
 assert.equal(topologyTowerLabel('复杂杆塔定位编号ABCDEFG','无关线路').endsWith('…'),true);
 assert.ok(estimateTowerLabelWidth('三秋001')>estimateTowerLabelWidth('ABC001'));
});
