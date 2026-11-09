import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { upgradeEquipmentFields } from '../../server/database/upgrade-equipment-fields.mjs';
import { createSystem } from '../../server/application/system.mjs';

function oldDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sd-equipment-upgrade-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // The historical committed authority is a test fixture, never a second schema source.
  const sql = execFileSync('git', ['show', '20afa8f:server/database/schema/schema113.sql'], { encoding: 'utf8' });
  const file = join(directory, 'schema113.sqlite');
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.exec("INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES('u','upgrade-user','salt:hash','admin','active','2026-11-09T00:00:00.000Z')");
  db.exec("INSERT INTO voltage_levels(id,code,name) VALUES('v','V','500kV')");
  db.exec("INSERT INTO transmission_lines(id,line_code,name,voltage_level_id,erection_type,created_by) VALUES('l','L','原线路','v','原架设事实','u')");
  db.exec("INSERT INTO physical_towers(id,tower_code,tower_type,created_by) VALUES('p','P','原塔型','u')");
  const lineJson = JSON.stringify(db.prepare("SELECT * FROM transmission_lines WHERE id='l'").get());
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO audit_events(id,actor_id,entity,entity_id,action,after_json,created_at) VALUES('old_line_audit','u','lines','l','create',?,?)").run(lineJson, timestamp);
  db.prepare("INSERT INTO ledger_requests(request_key,actor_id,request_hash,result_json,created_at) VALUES('old-line-request','u',?,?,?)").run('f'.repeat(64), lineJson, timestamp);
  db.close();
  return { directory, file };
}

test('explicit equipment upgrade rehearses a verified backup and preserves all remaining formal facts', async t => {
  const { directory, file } = oldDatabase(t);
  const destination = join(directory, 'backup');
  const result = await upgradeEquipmentFields(directory, destination);
  assert.equal(result.status, 'completed');
  assert.equal(result.cleaned_json_fields, 2);
  assert.ok(existsSync(join(destination, 'UPGRADE-RECEIPT.json')));
  const system = createSystem(directory);
  try {
    const line = system.repo.find('transmission_lines', 'id', 'l');
    assert.equal(line.name, '原线路');
    assert.equal(line.version, 1);
    assert.ok(!Object.hasOwn(line, 'erection_type'));
    const history = system.repo.list('line_history');
    assert.equal(history.length, 1);
    assert.ok(!Object.hasOwn(JSON.parse(system.repo.find('audit_events', 'id', 'old_line_audit').after_json), 'erection_type'));
    assert.ok(!Object.hasOwn(JSON.parse(system.repo.find('ledger_requests', 'request_key', 'old-line-request').result_json), 'erection_type'));
    assert.ok(!Object.hasOwn(history[0], 'erection_type'));
    assert.equal(system.repo.find('physical_towers', 'id', 'p').tower_nature, null);
    assert.equal(system.repo.list('physical_tower_history')[0].tower_nature, null);
    assert.equal(system.repo.integrity().foreignKeys.length, 0);
  } finally { system.close(); }
  const original = new DatabaseSync(join(destination, 'schema113.sqlite'), { readOnly: true });
  assert.equal(original.prepare('SELECT erection_type FROM transmission_lines').get().erection_type, '原架设事实');
  original.close();
  const after = readFileSync(file);
  assert.deepEqual(await upgradeEquipmentFields(directory, join(directory, 'retry')), { status: 'already_current' });
  assert.deepEqual(readFileSync(file), after);
});

test('maintenance upgrade rejects an unmatched database without changing its contents', async t => {
  const { directory, file } = oldDatabase(t);
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE unexpected(id TEXT) STRICT');
  db.close();
  const before = readFileSync(file);
  await assert.rejects(upgradeEquipmentFields(directory, join(directory, 'backup')), /升级基线/);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(existsSync(join(directory, 'backup')), false);
});

test('tower nature is a shared physical fact with immutable definition history', async t => {
  const { fixture } = await import('../helpers.mjs');
  const { s, user, save } = fixture(t);
  const voltage = save('voltages', { name: '500kV' });
  const lines = ['性质甲线', '性质乙线'].map(name => save('lines', { name, voltage_level_id: voltage.id }));
  const first = save('towers', { line_id: lines[0].id, tower_no: '#001', physical_properties: { tower_nature: 'straight' } });
  const shared = save('towers', { line_id: lines[1].id, tower_no: '#001', physical_tower_id: first.physical_tower_id });
  assert.equal(shared.tower_nature, 'straight');
  const physical = s.catalog.get('physical', first.physical_tower_id);
  s.catalog.save(user, 'physical', { expected_version: physical.version, tower_nature: 'tension' }, physical.id);
  assert.equal(s.catalog.get('towers', first.id).tower_nature, 'tension');
  assert.equal(s.catalog.get('towers', shared.id).tower_nature, 'tension');
  assert.equal(s.catalog.search('towers', { filters: { tower_nature: '耐' } }).total, 2);
  assert.equal(s.catalog.search('towers', { filters: { tower_nature: 'tension' } }).total, 2);
  assert.equal(s.catalog.search('physical', { q: '耐张' }).total, 1);
  const history = s.repo.where('physical_tower_history', { physical_tower_id: physical.id }, 'version');
  assert.deepEqual(history.map(row => row.tower_nature), ['tension', 'straight']);
  assert.throws(() => s.catalog.save(user, 'physical', { tower_nature: 'guessed' }), /CHECK|约束/);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});


test('cleanup also repairs a structurally upgraded database and retains unrelated custom JSON facts', async t => {
  const { directory } = oldDatabase(t);
  const firstBackup = join(directory, 'first-backup');
  await upgradeEquipmentFields(directory, firstBackup);
  const original = new DatabaseSync(join(firstBackup, 'schema113.sqlite'), { readOnly: true });
  const archivedLine = original.prepare("SELECT * FROM transmission_lines WHERE id='l'").get();
  original.close();
  archivedLine.custom_fields_json = JSON.stringify({ erection_type: '独立自定义事实' });
  const db = new DatabaseSync(join(directory, 'schema113.sqlite'));
  db.prepare("INSERT INTO audit_events(id,actor_id,entity,entity_id,action,after_json,created_at) VALUES('legacy_after_structure','u','lines','l','create',?,?)")
    .run(JSON.stringify(archivedLine), new Date().toISOString());
  db.close();
  const result = await upgradeEquipmentFields(directory, join(directory, 'cleanup-backup'));
  assert.equal(result.status, 'completed');
  assert.equal(result.cleaned_json_fields, 1);
  assert.equal(result.previous_structure_sha256, result.structure_sha256);
  const current = new DatabaseSync(join(directory, 'schema113.sqlite'));
  try {
    const record = JSON.parse(current.prepare("SELECT after_json FROM audit_events WHERE id='legacy_after_structure'").get().after_json);
    assert.ok(!Object.hasOwn(record, 'erection_type'));
    assert.deepEqual(JSON.parse(record.custom_fields_json), { erection_type: '独立自定义事实' });
    assert.throws(() => current.prepare("UPDATE audit_events SET after_json='{}' WHERE id='legacy_after_structure'").run(), /不可|immutable/);
  } finally { current.close(); }
});
