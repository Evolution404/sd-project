import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { passwordHash } from "../../dist/server/platform/auth/service.js";

test("admin initialization accepts a nonempty password shorter than 12 characters", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sd113-short-password-"));
  const system = createSystem(dir);
  t.after(() => {
    system.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.throws(() => system.auth.initialize("admin", ""), /密码/);
  assert.throws(() => system.auth.initialize("admin", "   "), /密码/);
  assert.throws(() => system.auth.initialize("admin", "x".repeat(257)), /256/);
  system.auth.initialize("admin", "a");
  const { user } = system.auth.login("admin", "a");
  assert.equal(user.role, "admin");
  assert.throws(() => system.auth.login("admin", "not-a"), /账号或密码错误/);
  assert.throws(() => system.auth.initialize("another", "b"), /已初始化/);
});

test("user creation, password change, and blank-on-edit preserve the same short password policy", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sd113-short-user-password-"));
  const system = createSystem(dir);
  t.after(() => {
    system.close();
    rmSync(dir, { recursive: true, force: true });
  });
  system.auth.initialize("admin", "1234");
  const admin = system.auth.login("admin", "1234").user;
  assert.throws(() => system.auth.saveUser(admin, {
    username: "bad", role: "viewer", password: "",
  }), /密码/);
  const created = system.auth.saveUser(admin, {
    username: "shortpass", role: "viewer", password: "1",
  });
  assert.equal(system.auth.login("shortpass", "1").user.role, "viewer");
  system.auth.saveUser(admin, {
    username: "shortpass", role: "viewer", status: "active", password: "",
  }, created.id);
  assert.equal(system.auth.login("shortpass", "1").user.username, "shortpass");
  system.auth.saveUser(admin, {
    username: "shortpass", role: "viewer", status: "active", password: "2",
  }, created.id);
  assert.throws(() => system.auth.login("shortpass", "1"), /账号或密码错误/);
  assert.equal(system.auth.login("shortpass", "2").user.username, "shortpass");
  assert.match(passwordHash("x"), /^[a-f0-9]{32}:[a-f0-9]{128}$/);
});
