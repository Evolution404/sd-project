import { seedCommonDefinitions } from "./seed/common.mjs";
import { createSystem } from "../dist/server/bootstrap.js";
import { createInterface } from "node:readline/promises";
import { packagedMode, newDatasetPath } from "../dist/server/platform/runtime/dataset.js";
const directory=packagedMode()==="production"?newDatasetPath(process.env.DATA_DIR):undefined;
const system = createSystem(directory);
try {
  const cli = createInterface({ input: process.stdin, output: process.stdout });
  const username =
    process.env.SD_ADMIN_USER || (await cli.question("管理员账号 "));
  const password =
    process.env.SD_ADMIN_PASSWORD ||
    (await cli.question("管理员密码 "));
  cli.close();
  const user = system.database.transaction(()=>{
    const created=system.auth.initialize(username,password);
    const session=system.auth.login(username,password);
    seedCommonDefinitions(system,session.user);
    system.auth.logout(session.token);
    return created;
  });
  console.log("SCHEMA113_ADMIN_CREATED", user.username);
} finally {
  system.close();
}
