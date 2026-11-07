import {randomUUID} from 'node:crypto';
import {db} from './connection.mjs';
import {dataRoot} from './data-path.mjs';
import {transaction} from './transaction.mjs';

export {db,dataRoot,transaction};
export {SCHEMA_VERSION} from './schema-version.mjs';
export {backupDatabase} from './backup.mjs';
export const now=()=>new Date().toISOString();
export const uid=()=>randomUUID();
export const one=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const exec=(sql,...args)=>db.prepare(sql).run(...args);
export function audit(actor,entity,id,action,before,after,reason=''){
 exec('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)',
  uid(),actor,entity,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason,now());
}
export function snapshot(item){
 return Object.fromEntries(Object.entries(item).filter(([key])=>!key.startsWith('_')));
}
