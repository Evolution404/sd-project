import test from 'node:test';
import assert from 'node:assert/strict';
import {operationDefinition} from '../../server/domain/operation-definition.mjs';
import {readOperationDefinition} from '../../web/src/shared/utils/operation-definition.ts';
const unit={id:'set',type_id:'unit',name:'套',status:'active'};
const profile={location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''};
const operation={id:'install',type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'安装',status:'active',work_target_type:'line',default_unit_id:unit.id};
test('an operation owns one stable unit and one work object in both server and UI definitions',()=>{
 assert.equal(operationDefinition(operation,unit).unit_id,'set');
 assert.deepEqual(readOperationDefinition(operation,[unit]),{unit_id:'set',unit_name:'套',work_target_type:'line',target_label:'线路侧设备',...profile});
 assert.equal(readOperationDefinition({...operation,work_target_type:'physical'},[unit]).target_label,'共用物理杆塔');
});
test('incomplete, ambiguous, deleted or disabled operation bindings cannot be used for new entry',()=>{
 for(const [op,u]of [[{...operation,work_target_type:'both'},unit],[{...operation,default_unit_id:null},unit],[operation,{...unit,status:'inactive'}],[operation,{...unit,id:'other'}]]){
  assert.throws(()=>operationDefinition(op,u),{status:422});assert.equal(readOperationDefinition(op,[u]),null);
 }
 assert.equal(readOperationDefinition(operation,[]),null);
});

test('operation position profiles reject missing, invalid, duplicate and incompatible locations',()=>{
 for(const p of [null,{}, {...profile,location_kinds:[]},{...profile,location_kinds:['tower','tower']},{...profile,location_kinds:['road']},{...profile,default_location_kind:'span'},{...profile,entry_hint:'字'.repeat(2001)}]){
  assert.throws(()=>operationDefinition({...operation,operation_profile:p},unit),{status:422});
 }
 const both={...profile,location_kinds:['tower','span'],default_location_kind:'span'};
 assert.deepEqual(operationDefinition({...operation,operation_profile:both},unit).location_kinds,['tower','span']);
 assert.throws(()=>operationDefinition({...operation,work_target_type:'physical',operation_profile:both},unit),{status:422});
 assert.equal(readOperationDefinition({...operation,operation_profile:null},[unit]),null);
 assert.equal(readOperationDefinition({...operation,work_target_type:'physical',operation_profile:both},[unit]),null);
});
