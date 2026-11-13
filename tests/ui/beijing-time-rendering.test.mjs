import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync, readdirSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {formatBeijingDateTime, formatVisibleDateTime, isTimestampField} from "../../web/src/shared/utils/datetime.ts";

test("Beijing timestamps use YYYY-MM-DD HH:mm:ss, UTC+08 irrespective of host timezone", () => {
  assert.equal(formatBeijingDateTime("2026-11-12T01:03:47.123Z"), "2026-11-12 09:03:47");
  assert.equal(formatBeijingDateTime("2026-11-12 01:03:47"), "2026-11-12 09:03:47");
  assert.equal(formatBeijingDateTime("2026-11-12T09:03:47+08:00"), "2026-11-12 09:03:47");
  assert.equal(formatBeijingDateTime("2026-11-12T16:00:00Z"), "2026-11-13 00:00:00");
  assert.equal(formatBeijingDateTime("2026-11-12"), "2026-11-12");
  assert.equal(formatBeijingDateTime(null), "—");
  assert.equal(formatVisibleDateTime("2026-11-12T01:03:47Z", "recorded_at"), "2026-11-12 09:03:47");
  assert.equal(formatVisibleDateTime("2026-11-12", "occurred_on"), "2026-11-12");
  assert.equal(isTimestampField("created_at"), true);
  assert.equal(isTimestampField("expected_on"), false);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const file = join(root, "web/src/shared/utils/datetime.ts");
  const code = `import {formatBeijingDateTime} from ${JSON.stringify("file://" + file)};
console.log(formatBeijingDateTime("2026-11-12T01:03:47Z"));`;
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd:root, encoding:"utf8", env:{...process.env,TZ:timezone},
    }).trim();
    assert.equal(output,"2026-11-12 09:03:47",timezone);
  }
});

test("timestamp rendering is centralized and raw time expressions are blocked in Vue", () => {
  const root=join(dirname(fileURLToPath(import.meta.url)),"..","..","web/src");
  const bad=[];
  function walk(dir) {
    for(const file of readdirSync(dir,{withFileTypes:true})) {
      const path=join(dir,file.name);
      if(file.isDirectory())walk(path);
      else if(file.name.endsWith(".vue")) {
        const content=readFileSync(path,"utf8");
        const checks=[
          {re:/new Date\([^)]*\)\.toLocale(?:Date)?String\(/g,why:"browser-local timezone must not be used"},
          // A custom BusinessTable slot that reads the original row instead of
          // the normalized slot value bypasses Asia/Shanghai rendering.
          {re:/\{\{\s*row\[column\.key\]\s*(?:\?\?|\|\|)\s*['"]—['"]\s*\}\}/g,
           why:"raw BusinessTable cell bypasses centralized timestamp formatting"},
          {re:/\{\{[^}\n]*\b(?:created_at|updated_at|recorded_at|changed_at|approved_at|confirmed_at|submitted_at|reviewed_at|timestamp)\b[^}\n]*\}\}/g,why:"raw timestamp interpolation"},
          {re:/:(?:label|title)="[^"\n]*(?:\.changed_at|\.recorded_at|\.created_at|\.updated_at)[^"\n]*"/g,why:"unformatted timestamp in a label"},
        ];
        for(const {re,why} of checks)for(const match of content.matchAll(re)) {
          const text=match[0];
          if (/formatBeijingDateTime|formatVisibleDateTime|factText\(/.test(text))continue;
          const line=content.slice(0,match.index).split("\n").length;
          bad.push(`${path.slice(root.length+1)}:${line} ${why}: ${text.slice(0,120)}`);
        }
      }
    }
  }
  walk(root);
  const demandPage=readFileSync(join(root,"modules/demands/DemandPage.vue"),"utf8");
  assert.match(demandPage, /function valueAt\([^)]*\)[^{]*\{\s*return formatVisibleDateTime\(/,
    "demand custom table cells must use the Beijing time display formatter");
  assert.deepEqual(bad,[],"Unformatted timestamps found in visible templates:\n"+bad.join("\n"));
});
