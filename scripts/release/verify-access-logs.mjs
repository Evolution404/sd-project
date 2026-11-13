import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Host smoke testing runs the actual extracted compiled server and production
// dependencies. Windows execution remains a separate platform acceptance.
export async function verifyPackageAccessLogs(base, headers, directory, expectedRequestId) {
  const response = await fetch(base + "/api/access-logs?page_size=200", { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.diagnostic, "");
  assert.ok(result.items.some(row => row.outcome === "登录成功"));
  if (expectedRequestId) assert.ok(result.items.some(row => row.request_id === expectedRequestId), "login log must survive service restart");
  const exported = await fetch(base + "/api/access-logs/export", { headers });
  assert.equal(exported.status, 200);
  const content = await exported.text();
  const rows = content.trim().split("\n").map(line => JSON.parse(line));
  assert.ok(rows.every(row => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.time)));
  assert.equal(content.includes(headers.Cookie), false);
  for (const secret of ["Package-verified-password", "DemoOnly-2026!", "password_hash", "Authorization", "Set-Cookie"])
    assert.equal(content.includes(secret), false);
  const files = readdirSync(join(directory, "logs")).filter(name => /^access-.*\.jsonl$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) {
    assert.ok(statSync(join(directory, "logs", name)).size <= result.max_file_bytes);
    for (const line of readFileSync(join(directory, "logs", name), "utf8").trim().split("\n")) JSON.parse(line);
  }
  return { files: files.length, records: rows.length };
}
