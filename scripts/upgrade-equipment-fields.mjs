import { resolve, join } from "node:path";
import { upgradeEquipmentFields } from "../server/database/upgrade-equipment-fields.mjs";

const directory = resolve(process.env.DATA_DIR || "data");
const destination = process.argv[2] || join(directory, "backups", "equipment-fields-" + new Date().toISOString().replaceAll(":", "-"));
const result = await upgradeEquipmentFields(directory, destination);
console.log(JSON.stringify({ status: result.status, backup: result.backup, preserved_facts_sha256: result.preserved_facts_sha256 }));
