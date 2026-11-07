import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const opSql=`INSERT INTO operations(id,code,name,work_target_type,default_unit_id,
 allow_tower,allow_span,default_location_kind,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`;
function fresh(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const part of ['tables','indexes','views','constraints'])
  db.exec(readFileSync(new URL('../../server/database/schema/'+part+'.sql',import.meta.url),'utf8'));
 return db;
}
test('operation entity independent of ordinary dictionary and correct FKs',()=>{
 const db=fresh();
 try{
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  assert.ok(names.includes('operations')&&names.includes('operation_versions'));
  assert.ok(!names.includes('operation_location_settings'));
  for(const table of ['demands','reference_price_catalog'])
   assert.ok(db.prepare('PRAGMA foreign_key_list('+table+')').all()
    .some(x=>x.from==='operation_id'&&x.table==='operations'));
  assert.ok(db.prepare('PRAGMA foreign_key_list(operations)').all()
   .some(x=>x.from==='default_unit_id'&&x.table==='dictionary_items'));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close()}
});
test('invalid unit, location ranges and operation-as-dictionary rejected by SQL',()=>{
 const db=fresh();
 try{
  db.exec(`INSERT INTO dictionary_types VALUES('unit','单位'),('source','来源'),('operation','操作类型');
   INSERT INTO dictionary_items(id,type_id,code,name,updated_at) VALUES('u','unit','u','套','2026');
   INSERT INTO dictionary_items(id,type_id,code,name,updated_at) VALUES('s','source','s','巡视','2026');`);
  assert.throws(()=>db.exec("INSERT INTO dictionary_items(id,type_id,code,name,updated_at) VALUES('op','operation','op','检修','2026')"),/CHECK constraint/);
  const add=db.prepare(opSql);
  assert.throws(()=>add.run('bad','bad','错误单位','line','s',1,0,'tower','2026'),/操作类型必须关联计量单位/);
  assert.throws(()=>add.run('empty','empty','无位置','line','u',0,0,'tower','2026'),/CHECK constraint/);
  assert.throws(()=>add.run('default','default','错误默认','line','u',1,0,'span','2026'),/CHECK constraint/);
  assert.throws(()=>add.run('physical','physical','物理位置','physical','u',1,1,'tower','2026'),/CHECK constraint/);
  add.run('good','good','线路检修','line','u',1,1,'tower','2026');
  assert.throws(()=>db.exec("UPDATE operations SET default_unit_id='s' WHERE id='good'"),/操作类型必须关联计量单位/);
  assert.throws(()=>db.exec("UPDATE operations SET work_target_type='physical' WHERE id='good'"),/CHECK constraint/);
  db.exec("UPDATE operations SET work_target_type='physical',allow_span=0,default_location_kind='tower' WHERE id='good'");
  assert.equal(db.prepare("SELECT allow_span FROM operations WHERE id='good'").get().allow_span,0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close()}
});
test('agreement belongs to the same funding framework as its project',()=>{
 const db=fresh();
 try{
  db.exec(`INSERT INTO users VALUES('u','admin','hash','admin','active','2026');
    INSERT INTO frameworks VALUES('f1','F1','框架1',2026,100000,'active',1,'2026','2026');
    INSERT INTO frameworks VALUES('f2','F2','框架2',2026,100000,'active',1,'2026','2026');
    INSERT INTO agreements VALUES('a1','A1','f1','协议',100000,'active',1,'2026','2026');`);
  const sql=`INSERT INTO projects(id,code,name,framework_id,agreement_id,created_by,created_at,updated_at)
   VALUES(?,?,?,?,?,'u','2026','2026')`;
  db.prepare(sql).run('p1','P1','正确关联','f1','a1');
  assert.throws(()=>db.prepare(sql).run('p2','P2','跨框架错误','f2','a1'),/FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close()}
});
