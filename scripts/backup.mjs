import { createSystem } from "../dist/server/bootstrap.js";
import { join } from "node:path";
const system = createSystem();
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
  system.close();
}
