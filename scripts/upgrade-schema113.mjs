// Explicit, backup-first Schema113 structure update; never runs on service startup.
import { resolve, join } from "node:path";
import { upgradeSchema113 } from "../server/database/upgrade-equipment-fields.mjs";

const directory = resolve(process.env.DATA_DIR || "data");
const destination = process.argv[2] || join(directory, "backups",
  "schema113-archived-master-guard-" + new Date().toISOString().replaceAll(":", "-"));
const result = await upgradeSchema113(directory, destination);
console.log(JSON.stringify({
  status: result.status, backup: result.backup,
  preserved_facts_sha256: result.preserved_facts_sha256,
  previous_structure_sha256: result.previous_structure_sha256,
  structure_sha256: result.structure_sha256,
}));
