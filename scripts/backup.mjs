import {backupDatabase} from '../server/database/index.mjs';
const dest=await backupDatabase();
console.log('备份生成：'+dest);
console.log('建议复制至另一物理介质。正式业务并发附件写入期间应采用维护窗口。');
