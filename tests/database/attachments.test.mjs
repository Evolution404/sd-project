import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

function createDatabase(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const part of ['tables.sql','indexes.sql','views.sql','constraints.sql'])
  db.exec(readFileSync(new URL('../../server/database/schema/'+part,import.meta.url),'utf8'));
 db.exec(`
  INSERT INTO users(id,username,password_hash,role,created_at) VALUES('u','admin','x','admin','2026');
  INSERT INTO source_records(id,created_by,created_at) VALUES('source','u','2026');
 `);
 return db;
}
const hash='a'.repeat(64);

test('attachment ownership is one strong reference, not an unverified type+id pair',()=>{
 const db=createDatabase();
 try{
  const columns=db.prepare('PRAGMA table_info(attachments)').all().map(x=>x.name);
  assert.ok(columns.includes('demand_id')&&columns.includes('source_id'));
  assert.ok(!columns.includes('owner_id')&&!columns.includes('owner_type'));
  const fk=db.prepare('PRAGMA foreign_key_list(attachments)').all();
  assert.ok(fk.some(x=>x.from==='demand_id'&&x.table==='demands'));
  assert.ok(fk.some(x=>x.from==='source_id'&&x.table==='source_records'));
  assert.ok(fk.some(x=>x.from==='uploaded_by'&&x.table==='users'));
  const insert=db.prepare(`INSERT INTO attachments
   (id,demand_id,source_id,storage_key,filename,bytes,sha256,uploaded_by,created_at)
   VALUES(?,?,?,?,?,?,?,?,?)`);
  const args=(id,demand=null,source=null,bytes=5)=>
   [id,demand,source,'key-'+id,'证据.txt',bytes,hash,'u','2026'];
  assert.throws(()=>insert.run(...args('none')),/CHECK constraint failed/);
  assert.throws(()=>insert.run(...args('both','demand','source')),/CHECK constraint failed/);
  assert.throws(()=>insert.run(...args('bad-demand','missing',null)),/FOREIGN KEY constraint failed/);
  assert.throws(()=>insert.run(...args('bad-source',null,'missing')),/FOREIGN KEY constraint failed/);
  assert.throws(()=>insert.run(...args('zero',null,'source',0)),/CHECK constraint failed/);
  insert.run(...args('good',null,'source'));
  assert.equal(db.prepare("SELECT source_id FROM attachments WHERE id='good'").get().source_id,'source');
  assert.throws(()=>db.exec("DELETE FROM source_records WHERE id='source'"),/FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close()}
});
