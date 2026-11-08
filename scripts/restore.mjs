import { restoreBackup } from "../server/database/restore.mjs";
if (process.argv.length !== 4)
  throw Error("用法 node scripts/restore.mjs 备份目录 全新恢复目录");
console.log("RESTORED", restoreBackup(process.argv[2], process.argv[3]));
