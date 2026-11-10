import { createSystem } from "../dist/server/bootstrap.js";
import { createInterface } from "node:readline/promises";
const system = createSystem();
try {
  const cli = createInterface({ input: process.stdin, output: process.stdout });
  const username =
    process.env.SD_ADMIN_USER || (await cli.question("管理员账号 "));
  const password =
    process.env.SD_ADMIN_PASSWORD ||
    (await cli.question("管理员密码 "));
  cli.close();
  const user = system.auth.initialize(username, password);
  console.log("SCHEMA113_ADMIN_CREATED", user.username);
} finally {
  system.close();
}
