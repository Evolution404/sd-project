import { createSystem } from "../dist/server/bootstrap.js";
import { join } from "node:path";
import { packagedMode, selectedDataset, acquireDataset } from "../dist/server/platform/runtime/dataset.js";
const directory=packagedMode()==="production"?selectedDataset():undefined;
const unlock=directory?acquireDataset(directory):undefined;
const system=(()=>{try{return createSystem(directory)}catch(error){unlock?.();throw error}})();
try {
  console.log(
    await system.database.backupTo(
      join(
        system.database.directory,
        "backups",
        new Date().toISOString().replaceAll(":", "-"),
      ),
    ),
  );
} finally {
  try { system.close(); } finally { unlock?.(); }
}
