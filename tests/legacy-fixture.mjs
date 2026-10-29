import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function legacyDatabase(root){
 const db=new DatabaseSync(join(root,'business.sqlite'));
 for(const file of ['core-towers.sql','business.sql','migration-002.sql','migration-003.sql','migration-004.sql'])db.exec(readFileSync(new URL('../server/'+file,import.meta.url),'utf8'));
 db.exec('PRAGMA user_version=4');return db;
}
export function legacyBusiness(db){
 const t='2026-10-01T00:00:00.000Z';
 const insert=(table,row)=>db.prepare('INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
 insert('users',{id:'u',username:'legacy',password_hash:'unused',role:'admin',status:'active',created_at:t});
 insert('voltage_levels',{id:'v',code:'110',name:'110kV',status:'active'});
 insert('transmission_lines',{id:'l',line_code:'L',voltage_level_id:'v',name:'旧线路',status:'active',version:1,created_at:t,updated_at:t});
 insert('physical_towers',{id:'pt',tower_code:'PT',status:'active',version:1,created_at:t,updated_at:t});
 insert('logical_towers',{id:'lt',logical_code:'LT',line_id:'l',physical_tower_id:'pt',tower_no:'#1',sort_rank:1,status:'active',version:1,created_at:t,updated_at:t});
 for(const id of ['unit','operation'])insert('dictionary_types',{id,title:id});
 insert('dictionary_items',{id:'unit',type_id:'unit',code:'SET',name:'套',status:'active',sort_order:1,version:1,fields_json:'[]',updated_at:t});
 const op={id:'op',type_id:'operation',code:'INSTALL',name:'安装防鸟装置',status:'active',sort_order:1,version:1,work_target_type:'line',default_unit_id:'unit',default_quantity_milli:2000,completion_standard:'安装验收',fields_json:'[]',updated_at:t};
 insert('dictionary_items',op);insert('dictionary_item_versions',{id:'dict-rev',item_id:'op',version:1,snapshot_json:JSON.stringify(op),changed_by:'u',changed_at:t});
 insert('demand_batches',{id:'batch',draft_json:JSON.stringify({quantity:'2'}),status:'submitted',version:1,idempotency_key:'batch-key',payload_sha256:'unchanged',created_by:'u',created_at:t,updated_at:t});
 const d={id:'d',demand_no:'XQ-LEGACY',batch_id:'batch',logical_tower_id:'lt',observed_physical_tower_id:'pt',line_name_snapshot:'旧线路',tower_no_snapshot:'#1',physical_code_snapshot:'PT',work_target_type:'line',operation_id:'op',operation_version:1,operation_snapshot:'安装防鸟装置',target_object:'横担',quantity_milli:2000,unit_id:'unit',unit_version:1,unit_snapshot:'套',completion_standard:'安装验收',problem_description:'原始问题',status:'active',version:2,confirmed_at:t,created_by:'u',created_at:t,updated_at:t};
 insert('demands',{...d,version:3,status:'pending',problem_description:'最新补充说明'});
 insert('demand_revisions',{id:'rev',demand_id:'d',version:2,snapshot_json:JSON.stringify(d),reason:'补充说明',changed_by:'u',changed_at:t});
 insert('frameworks',{id:'fw',code:'FW',name:'框架',limit_fen:10000000,status:'active',version:1,created_at:t,updated_at:t});
 insert('agreements',{id:'ag',code:'AG',framework_id:'fw',name:'协议',limit_fen:10000000,status:'active',version:1,created_at:t,updated_at:t});
 insert('projects',{id:'pr',code:'PR',name:'项目',agreement_id:'ag',status:'approved',version:5,estimate_fen:20002,approved_budget_fen:20002,created_by:'u',created_at:t,updated_at:t});
 const scope={id:'scope',project_id:'pr',demand_id:'d',demand_version:2,quantity_milli:2000,unit_price_fen:10001,price_source:'定额',price_date:'2026-10-01',tax_mode:'inclusive',note:'',created_at:t,updated_at:t};
 insert('project_demand_scopes',scope);
 for(const stage of ['stocked','approved'])insert('project_stage_events',{id:stage,project_id:'pr',stage,project_version:stage==='stocked'?4:5,snapshot_json:JSON.stringify({stage,scopes:[{scope_id:'scope',demand_id:'d',demand_version:2,quantity_milli:2000,unit_price_fen:10001,amount_fen:20002}]}),reason:'审批',actor_id:'u',created_at:t});
 insert('executions',{id:'ex',project_id:'pr',number:'EX',description:'',status:'running',version:3,started_at:t,created_by:'u',created_at:t,updated_at:t});
 insert('execution_items',{id:'item',execution_id:'ex',project_scope_id:'scope',planned_quantity_milli:500,actual_physical_tower_id:'pt',created_at:t});
 const hash=createHash('sha256').update(JSON.stringify({executionId:'ex',itemId:'item',q:250,date:'2026-10-01',evidence:'验收'})).digest('hex');
 insert('completion_records',{id:'comp',execution_item_id:'item',quantity_milli:250,occurred_on:'2026-10-01',evidence:'验收',confirmed_by:'u',confirmed_at:t,idempotency_key:'completion',payload_hash:hash});
 insert('audit_events',{id:'audit',actor_id:'u',entity:'demands',entity_id:'d',action:'revise',before_json:JSON.stringify(d),after_json:JSON.stringify({...d,version:3}),reason:'说明修订',created_at:t});
}
