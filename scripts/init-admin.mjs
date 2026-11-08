import { createSystem } from "../server/application/system.mjs";
import { createInterface } from "node:readline/promises";
const system = createSystem();
try {
  const cli = createInterface({ input: process.stdin, output: process.stdout });
  const username =
    process.env.SD_ADMIN_USER || (await cli.question("管理员账号 "));
  const password =
    process.env.SD_ADMIN_PASSWORD ||
    (await cli.question("管理员密码（至少12位） "));
  cli.close();
  const user = system.auth.initialize(username, password);
  console.log("SCHEMA113_ADMIN_CREATED", user.username);
} finally {
  system.close();
}
