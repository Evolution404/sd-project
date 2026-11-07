import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {dataRoot} from './data-path.mjs';
import {initializeSchema} from './bootstrap.mjs';

for(const folder of [dataRoot,join(dataRoot,'attachments'),join(dataRoot,'backups')]){
 mkdirSync(folder,{recursive:true});
}
export const db=new DatabaseSync(join(dataRoot,'business.sqlite'),{timeout:5000});
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
initializeSchema(db);
