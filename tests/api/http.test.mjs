import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
test("actual HTTP login, permissions, optimistic locking, idempotency and IP guard", async (t) => {
  const { s, user } = fixture(t),
    server = httpServer(s);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const unauth = await fetch(base + "/api/demands");
  assert.equal(unauth.status, 401);
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "Schema113-test-password",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    "Idempotency-Key": "http-request-0001",
  };
  const input = JSON.stringify({ code: "http-unit", name: "件" }),
    first = await fetch(base + "/api/catalog/units", {
      method: "POST",
      headers,
      body: input,
    });
  assert.equal(first.status, 200);
  const item = await first.json();
  const replay = await fetch(base + "/api/catalog/units", {
    method: "POST",
    headers,
    body: input,
  });
  assert.deepEqual(await replay.json(), item);
  const conflict = await fetch(base + "/api/catalog/units/" + item.id, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "http-request-0002" },
    body: JSON.stringify({ name: "个", expected_version: 0 }),
  });
  assert.equal(conflict.status, 409);
  const racing = await Promise.all(
    ["并发单位甲", "并发单位乙"].map((name, index) =>
      fetch(base + "/api/catalog/units/" + item.id, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "concurrent-unit-" + index },
        body: JSON.stringify({ name, expected_version: 1 }),
      }),
    ),
  );
  assert.deepEqual(
    racing.map((response) => response.status).sort(),
    [200, 409],
  );
  const userRow = s.auth.saveUser(user, {
    username: "viewer",
    password: "Viewer-test-password",
    role: "viewer",
  });
  const viewer = s.auth.login(userRow.username, "Viewer-test-password");
  const denied = await fetch(base + "/api/catalog/units", {
    method: "POST",
    headers: {
      ...headers,
      Cookie: "sd113=" + viewer.token,
      "Idempotency-Key": "viewer-request-01",
    },
    body: input,
  });
  assert.equal(denied.status, 403);
  assert.equal(s.auth.permittedIp("192.0.2.10"), false);
  assert.equal(s.auth.permittedIp("::ffff:127.0.0.1"), true);
  const csrf = await fetch(base + "/api/catalog/units", {
    method: "POST",
    headers: { ...headers, Origin: "https://other.example" },
    body: input,
  });
  assert.equal(csrf.status, 403);
  const originalIpCheck = s.auth.permittedIp;
  const seen = [];
  s.auth.permittedIp = (address) => {
    seen.push(address);
    return false;
  };
  try {
    assert.equal(
      (await fetch(base + "/", { headers: { "X-Forwarded-For": "127.0.0.1" } }))
        .status,
      403,
    );
    assert.equal((await fetch(base + "/api/demands", { headers })).status, 403);
    assert.ok(seen.every((address) => address === "127.0.0.1"));
  } finally {
    s.auth.permittedIp = originalIpCheck;
  }
  const repeatedCode = await fetch(base + "/api/catalog/units", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "duplicate-safe-message" },
    body: input,
  });
  assert.equal(repeatedCode.status, 422);
  assert.ok(!(await repeatedCode.json()).message.includes("constraint"));
});
