import { restoreBackup } from "../dist/server/database/restore.js";
import { packagedMode, newDatasetPath } from "../dist/server/platform/runtime/dataset.js";
if (process.argv.length !== 4)
  throw Error("用法 node scripts/restore.mjs 备份目录 全新恢复目录");
console.log("RESTORED", restoreBackup(process.argv[2], packagedMode()==="production"?newDatasetPath(process.argv[3]):process.argv[3]));
