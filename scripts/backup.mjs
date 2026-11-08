import { createSystem } from '../server/application/system.mjs';
import { join } from 'node:path';
const system=createSystem();
try {console.log(await system.database.backupTo(join(system.database.directory,'backups',new Date().toISOString().replaceAll(':','-'))));}
finally {system.close();}
