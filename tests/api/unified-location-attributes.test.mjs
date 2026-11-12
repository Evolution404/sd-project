import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,attribute} from '../helpers.mjs';

test('logical circuits and spans use true identities, frozen equipment attributes and their adopted operation version',t=>{
  const {s,user,save,unit}=fixture(t);
  const voltage=save('voltages',{name:'220kV'}),line=save('lines',{name:'甲线',voltage_level_id:voltage.id}),other=save('lines',{name:'乙线',voltage_level_id:voltage.id});
  const first=save('towers',{line_id:line.id,tower_no:'12',physical_properties:{tower_type:'angle'}}),end=save('towers',{line_id:line.id,tower_no:'13'});
  const shared=save('towers',{line_id:other.id,tower_no:'12',physical_tower_id:first.physical_tower_id});
  const span=save('spans',{line_id:line.id,start_tower_id:first.id,end_tower_id:end.id,status:'active'});
  const object=save('objects',{name:'绝缘子串',work_target_type:'line'});
  const asset=attribute({key:'tower',label:'塔型',source:'asset',asset_field:'tower_type',options:[],requirement:'optional'});
  const operation=save('operations',{name:'更换绝缘子串',work_object_id:object.id,default_unit_id:unit.id,allow_tower:1,allow_span:1,completion_standard:'质量合格',attributes_schema_json:[asset]});
  const demand=s.demands.save(user,{operation_id:operation.id,problem_description:'两回路各自处理',work_locations:[first,shared].map(row=>({location_kind:'logical_tower',logical_tower_id:row.id,quantity_scaled:10000}))});
  assert.equal(demand.observed_physical_tower_id,first.physical_tower_id);
  assert.equal(demand.work_locations[0].attributes.tower,'angle');
  assert.equal(demand.work_locations[1].attributes.tower,'angle');
  s.equipment.save(user,'physical',{expected_version:1,tower_type:'pipe'},first.physical_tower_id);
  const revised=s.demands.save(user,{expected_version:1,problem_description:'更正文字，保留原现场依据'},demand.id);
  assert.equal(revised.work_locations[0].attributes.tower,'angle');
  assert.equal(revised.work_locations[0].location_snapshot_json.tower_type,'angle');
  assert.throws(()=>s.demands.save(user,{expected_version:2,work_locations:[{...revised.work_locations[0],attributes:{tower:'伪造'}}]},demand.id),/真实台账/);
  const spanDemand=s.demands.save(user,{operation_id:operation.id,problem_description:'档距位置',work_locations:[{location_kind:'span',span_id:span.id,quantity_scaled:20000}]});
  assert.equal(spanDemand.span_id,span.id);assert.equal(spanDemand.logical_tower_id,null);
  assert.equal(spanDemand.work_locations[0].location_snapshot_json.location_label,'12 ~ 13');
});
