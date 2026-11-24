import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Protect the active Schema113 application boundary against tax-specific fields
// or calculations returning through future edits. Historical design notes and
// explicit negative-schema assertions are not product code.
const root = resolve(import.meta.dirname, "..");
const roots = ["server", "web/src", "tests/fixtures/legacy-frontend/web/src", "tests/api", "tests/domain", "tests/excel"];
const suffixes = new Set([".mjs", ".js", ".ts", ".vue", ".sql"]);
const forbidden = /税率|税额|税费|税金|含税|不含税|计税|\btax_(?:rate|mode|basis|amount)\b|\btax(?:Rate|Mode|Amount|Basis)\b|\bvat(?:Rate|Amount)?\b/i;
const violations = [];
function visit(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const name = join(relative, entry.name);
    if (entry.isDirectory()) visit(name);
    else if ([...suffixes].some((suffix) => entry.name.endsWith(suffix))) {
      const code = readFileSync(join(root, name), "utf8");
      const lines = code.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++)
        if (forbidden.test(lines[i])) violations.push(name + ":" + (i + 1));
    }
  }
}
roots.forEach(visit);
if (violations.length) {
  console.error("Schema113 不允许引入税务专用业务字段、计算或界面：");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("NO_TAX_CONCEPTS_OK", roots.join(", "));
}
