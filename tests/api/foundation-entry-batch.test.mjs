import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../helpers.mjs";

test("foundation and system batches use existing authority, precision, lifecycle and scope commands", t => {
  const { s, user } = fixture(t);
  const row = (ref, values, id) => ({ ref: String(ref), values, id });
  function submit(execute, rows) {
    const preview = execute({ rows }, false);
    assert.equal(preview.count, rows.length);
    return execute({ rows, fingerprint: preview.fingerprint }, true).ids;
  }
  const entry = (kind) => (input, commit) => s.dictionaries.entryBatch(user, kind, input, commit);
  assert.throws(() => entry("units")({ rows: [row(1, { name: "遗漏精度" })] }, false),
    fault => fault.fields.batch_field === "quantity_precision");
  const [unitId] = submit(entry("units"), [row(1, { name: "批量精确单位", quantity_precision: 3 })]);
  assert.equal(s.dictionaries.getDictionary("units", unitId).quantity_precision, 3);
  assert.equal(s.dictionaries.getDictionary("units", unitId).version, 1);
  assert.throws(() => entry("units")({ rows: [row(1, { name: "非法精度", quantity_precision: 5 })] }, false));
  const volts = (input, commit) => s.equipment.voltageEntryBatch(user, input, commit);
  const [voltageId] = submit(volts, [row(1, { name: "220kV" })]);
  assert.equal(s.equipment.get("voltages", voltageId).name, "220kV");

  const funding = kind => (input, commit) => s.funding.entryBatch(user, kind, input, commit);
  const [framework] = submit(funding("frameworks"), [row(1, { name: "批量2026框架", limit_fen: 125656, fiscal_year: 2026 })]);
  const agreements = [
    row(1, { name: "批量协议甲", framework_id: framework, limit_fen: 1077, effective_from: "2026-11-01", effective_to: "2026-12-01" }),
    row(2, { name: "批量协议乙", framework_id: framework, limit_fen: 1255, effective_from: "2026-11-20", effective_to: "2026-11-01" }),
  ];
  assert.throws(() => funding("agreements")({ rows: agreements }, false),
    fault => fault.fields.batch_id === "2" && /截止日期/.test(fault.message));
  assert.equal(s.funding.search("agreements", { page: 1, page_size: 20, q: "批量协议", filters: {} }).total, 0);
  agreements[1].values.effective_to = "2026-12-01";
  const agreementIds = submit(funding("agreements"), agreements);
  assert.ok(agreementIds.every(id => s.funding.get("agreements", id).framework_id === framework));

  const [parent] = submit(entry("organizations"), [row(1, { name: "批量顶级组织" })]);
  const [child] = submit(entry("organizations"), [row(1, { name: "批量下级组织", parent_unit_id: parent })]);
  assert.equal(s.dictionaries.getOrganization(child).parent_unit_id, parent);
  assert.throws(() => entry("organizations")({ rows: [row(1, { name: "越权移挂", expected_version: 1, parent_unit_id: null }, child)] }, false),
    /不允许写入/);

  const accounts = (input, commit) => s.management.entryBatch(user, "users", input, commit);
  const [account] = submit(accounts, [row(1, { username: "generated_profile_one", display_name: "合成用户甲", employee_no: "B01" })]);
  const staged = s.management.userDetail(user, account);
  assert.equal(staged.status, "disabled");
  assert.deepEqual(staged.role_codes, ["viewer"]);
  assert.equal(Object.hasOwn(staged, "password"), false);
  assert.equal(staged.employee_no, "B01");
  assert.throws(() => accounts({ rows: [row(1, { display_name: "合成用户乙", expected_version: 1, role: "admin" }, account)] }, false),
    /不允许写入/);
  submit(accounts, [row(1, { display_name: "合成用户更正", expected_version: 1, employee_no: "B02" }, account)]);
  assert.equal(s.management.userDetail(user, account).status, "disabled");
  assert.throws(() => s.management.entryBatch({ ...user, permissions: ["read"] }, "users",
    { rows: [row(1, { username: "forbidden", display_name: "应拒绝" })] }, false), fault => fault.status === 403);

  const ips = (input, commit) => s.management.entryBatch(user, "ips", input, commit);
  const grants = [row(1, { ip: "192.0.2.11", note: "合成授权" }), row(2, { ip: "198.51.100.0/24", note: "范围须拦截" })];
  assert.throws(() => ips({ rows: grants }, false), fault => fault.fields.batch_id === "2");
  assert.equal(s.management.ips(user).length, 0);
  grants[1].values.ip = "2001:db8::11";
  const oldPolicy = ips({ rows: grants }, false);
  const policy = s.management.accessPolicy(user);
  s.management.setAccessPolicy(user, { ip_restriction_enabled: !policy.ip_restriction_enabled, expected_version: policy.version });
  assert.throws(() => ips({ rows: grants, fingerprint: oldPolicy.fingerprint }, true), fault => fault.status === 409);
  const [grant] = submit(ips, grants);
  const current = s.management.ips(user).find(item => item.id === grant);
  const changes = [row(1, { note: "合成授权更正", expected_snapshot: JSON.stringify([current.ip, current.note, current.created_at]) }, grant)];
  const proof = ips({ rows: changes }, false);
  s.management.saveIp(user, { ip: current.ip, note: "并发修改" }, grant);
  assert.throws(() => ips({ rows: changes, fingerprint: proof.fingerprint }, true), fault => fault.status === 409);
  assert.equal(s.management.ips(user).find(item => item.id === grant).note, "并发修改");
});
