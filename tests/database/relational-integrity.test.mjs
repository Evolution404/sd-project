import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeSchema} from '../../server/database/bootstrap.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');initializeSchema(db);
 db.exec(`
 INSERT INTO users(id,username,password_hash,role,created_at) VALUES('u','tester','hash','admin','2026');
 INSERT INTO voltage_levels(id,code,name) VALUES('v','110','110kV');
 INSERT INTO transmission_lines(id,line_code,voltage_level_id,name) VALUES('l','l','v','测试线');
 INSERT INTO transmission_lines(id,line_code,voltage_level_id,name) VALUES('l2','l2','v','其他线');
 INSERT INTO physical_towers(id,tower_code) VALUES('p','P');
 INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank)
  VALUES('a','a','l','p','#001',1);
 INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank)
  VALUES('b','b','l','p','#002',2);
 INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank)
  VALUES('other','other','l2','p','#101',1);
 INSERT INTO line_spans(id,line_id,start_tower_id,end_tower_id,status,created_by,created_at,updated_at)
  VALUES('sp','l','a','b','active','u','2026','2026');
 INSERT INTO dictionary_items(id,type_id,code,name,updated_at) VALUES('unit','unit','piece','处','2026');
 INSERT INTO dictionary_items(id,type_id,code,name,updated_at) VALUES('source','source','s','巡视','2026');
 INSERT INTO operations(id,code,name,work_target_type,default_unit_id,allow_tower,
  allow_span,default_location_kind,updated_at)
  VALUES('op','op','线路作业','line','unit',1,1,'tower','2026');
 INSERT INTO operations(id,code,name,work_target_type,default_unit_id,allow_tower,
  allow_span,default_location_kind,updated_at)
  VALUES('pop','pop','实体作业','physical','unit',1,0,'tower','2026');
 INSERT INTO operation_versions(id,operation_id,version,snapshot_json,changed_by,changed_at)
  VALUES('ov','op',1,'{}','u','2026');
 INSERT INTO operation_versions(id,operation_id,version,snapshot_json,changed_by,changed_at)
  VALUES('pov','pop',1,'{}','u','2026');
 `);
 return db;
}
const base={line_name_snapshot:'测试线',tower_no_snapshot:'#001',
 work_target_type:'line',operation_id:'op',operation_version:1,operation_snapshot:'线路作业',
 target_object:'导线',quantity_scaled:10000,unit_id:'unit',unit_version:1,unit_snapshot:'处',
 completion_standard:'验收',problem_description:'现场缺陷',created_by:'u',created_at:'2026',updated_at:'2026'};
function insert(db,id,changes={}){
 const row={...base,id,demand_no:id,...changes},cols=Object.keys(row);
 db.prepare('INSERT INTO demands('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')')
  .run(...Object.values(row));
}
test('three mutually exclusive demand locators, virtual location type and historical operation FK',()=>{
 const db=fixture();
 try{
  insert(db,'tower',{logical_tower_id:'a',observed_physical_tower_id:'p'});
  insert(db,'span',{span_id:'sp',span_version:1,span_snapshot_json:'{}'});
  insert(db,'physical',{work_target_type:'physical',operation_id:'pop',physical_tower_id:'p',context_line_id:'l'});
  const rows=db.prepare('SELECT id,logical_tower_id,physical_tower_id,span_id,location_kind FROM demands ORDER BY id').all();
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(r=>[r.id,r.location_kind]),[['physical','tower'],['span','span'],['tower','tower']]);
  assert.equal(rows.find(r=>r.id==='span').logical_tower_id,null);
  assert.equal(rows.find(r=>r.id==='physical').logical_tower_id,null);
  assert.throws(()=>insert(db,'bad-span',{logical_tower_id:'a',span_id:'sp',span_version:1,span_snapshot_json:'{}',observed_physical_tower_id:'p'}),/CHECK constraint/);
  assert.throws(()=>insert(db,'bad-physical',{work_target_type:'physical',operation_id:'pop',logical_tower_id:'a',physical_tower_id:'p'}),/CHECK constraint|需求杆塔实体关联与实际位置不一致/);
  assert.throws(()=>insert(db,'wrong-version',{logical_tower_id:'a',observed_physical_tower_id:'p',operation_version:2}),/需求操作类型|FOREIGN KEY/);
  assert.throws(()=>insert(db,'wrong-unit',{logical_tower_id:'a',observed_physical_tower_id:'p',unit_id:'source'}),/需求操作类型|需求计量单位/);
  assert.throws(()=>db.exec(`INSERT INTO line_spans(id,line_id,start_tower_id,end_tower_id,status,created_by,created_at,updated_at)
   VALUES('cross','l','a','other','active','u','2026','2026')`),/档距端点必须属于本线路/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close()}
});

test('cross-project execution, budget approval, settlement and framework references fail closed',()=>{
 const db=fixture();
 try{
  insert(db,'demand',{logical_tower_id:'a',observed_physical_tower_id:'p'});
  db.exec(`
   INSERT INTO frameworks VALUES('f1','F1','框架1',2026,100000,'active',1,'2026','2026');
   INSERT INTO frameworks VALUES('f2','F2','框架2',2026,100000,'active',1,'2026','2026');
   INSERT INTO agreements VALUES('a1','A1','f1','协议1',50000,'active',1,'2026','2026');
   INSERT INTO agreements VALUES('a2','A2','f2','协议2',50000,'active',1,'2026','2026');
   INSERT INTO projects(id,code,name,framework_id,agreement_id,created_by,created_at,updated_at)
    VALUES('p1','P1','项目1','f1','a1','u','2026','2026');
   INSERT INTO projects(id,code,name,framework_id,agreement_id,created_by,created_at,updated_at)
    VALUES('p2','P2','项目2','f2','a2','u','2026','2026');
   INSERT INTO project_demand_scopes(id,project_id,demand_id,demand_version,quantity_scaled,created_at,updated_at)
    VALUES('scope','p1','demand',1,10000,'2026','2026');
   INSERT INTO project_approval_versions(id,project_id,version_no,snapshot_json,approved_budget_fen,approved_by,created_at)
    VALUES('approval1','p1',1,'{}',10000,'u','2026');
   INSERT INTO project_approval_versions(id,project_id,version_no,snapshot_json,approved_budget_fen,approved_by,created_at)
    VALUES('approval2','p2',1,'{}',10000,'u','2026');
   INSERT INTO executions(id,project_id,number,plan_type,created_by,created_at,updated_at,approval_version_id)
    VALUES('plan','p2','JH1','outage','u','2026','2026','approval2');
  `);
  assert.throws(()=>db.exec(`UPDATE projects SET agreement_id='a1' WHERE id='p2'`),/FOREIGN KEY/);
  assert.throws(()=>db.exec(`INSERT INTO execution_items(id,execution_id,project_scope_id,planned_quantity_scaled,created_at)
   VALUES('item','plan','scope',10000,'2026')`),/检修计划不能引用其他子项目/);
  assert.throws(()=>db.exec(`INSERT INTO plan_budget_drafts
   (id,execution_id,kind,amount_fen,basis,base_budget_version,project_approval_version_id,status,
   created_by,created_at,updated_by,updated_at)
   VALUES('draft','plan','set',10000,'年度预算',0,'approval1','draft','u','2026','u','2026')`),/预算草稿批准版本/);
  assert.throws(()=>db.exec(`INSERT INTO project_settlement_entries
   (id,project_id,project_scope_id,approval_version_id,settlement_no,entry_kind,
   settlement_type,amount_fen,occurred_on,evidence,recorded_by,created_at)
   VALUES('settlement','p2','scope','approval2','S1','payment','progress',500,'2026','凭证','u','2026')`),/结算项目、需求范围/);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close()}
});
