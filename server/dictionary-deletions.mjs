// The existing append-only deletion audit is also the durable deletion ledger.
// Keeping its intent prevents factory defaults from returning after a restart.
export function dictionaryDeletions(db){
 const events=db.prepare("SELECT * FROM audit_events WHERE entity IN ('voltage_levels','dictionary_items') AND action='delete' ORDER BY created_at DESC,rowid DESC").all();
 const seen=new Set();
 return events.filter(event=>{
  const key=event.entity+':'+event.entity_id;
  if(seen.has(key))return false;seen.add(key);return true;
 }).map(event=>({event,before:JSON.parse(event.before_json),after:event.after_json?JSON.parse(event.after_json):{deletion_kind:'physical'}}));
}
export function dictionaryDeleted(db,table,id){
 return !!db.prepare("SELECT 1 FROM audit_events WHERE entity=? AND entity_id=? AND action='delete' LIMIT 1").get(table,id);
}
export function currentDictionaryRows(db,table,rows){
 const deleted=new Set(db.prepare("SELECT entity_id FROM audit_events WHERE entity=? AND action='delete'").all(table).map(x=>x.entity_id));
 return rows.filter(row=>!deleted.has(row.id));
}
