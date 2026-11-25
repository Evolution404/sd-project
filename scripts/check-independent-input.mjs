import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { catalogDefinitions } from "../dist/server/modules/catalog/definitions.js";
import { layouts } from "../dist/server/modules/exchange/workbook.js";
const root = resolve(import.meta.dirname, ".."),
  violations = [];
function visit(directory) {
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (
      /\.(?:mjs|ts|vue|sql|json|ps1|cmd)$/.test(entry.name) &&
      path !== "scripts/check-independent-input.mjs"
    ) {
      if (
        /\bpms\b|pms[_/-]/i.test(
          path + "\n" + readFileSync(join(root, path), "utf8"),
        )
      )
        violations.push(path + " contains prohibited integration identity");
    }
  }
}
for (const directory of ["server", "web/src", "tests/fixtures/legacy-frontend/web/src", "scripts"]) visit(directory);
for (const [kind, definition] of Object.entries(catalogDefinitions))
  for (const field of definition.rootFields)
    if (field.key.endsWith("code") && (!field.systemManaged || field.required))
      violations.push(kind + "." + field.key + " must be server-owned");
for (const sheets of Object.values(layouts))
  for (const sheet of sheets)
    for (const column of sheet.columns)
      if (column.endsWith("_code"))
        violations.push(sheet.name + " requests a technical code");
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "INDEPENDENT_INPUT_OK no dedicated external integration, server-owned catalog codes, business-only workbook references",
  );
