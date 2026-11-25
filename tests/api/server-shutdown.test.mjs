import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { registerManagedShutdown, requestManagedShutdown } from "../../dist/server/platform/runtime/managed-shutdown.js";

test("managed shutdown closes empty preconnections and completes an already started HTTP request", async t => {
  const f = fixture(t), server = httpServer(f.s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const empty = connect({ host: "127.0.0.1", port });
  const active = connect({ host: "127.0.0.1", port });
  t.after(() => { empty.destroy(); active.destroy(); server.closeAllConnections(); });
  await Promise.all([once(empty, "connect"), once(active, "connect")]);
  const emptyClosed = once(empty, "close");
  const body = JSON.stringify({ username: "admin", password: "Schema113-test-password" });
  const requested = once(server, "request");
  active.write("POST /api/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: "
    + Buffer.byteLength(body) + "\r\nConnection: close\r\n\r\n" + body.slice(0, 1));
  await requested;
  let closed = false;
  const stopped = new Promise((resolve, reject) => {
    const release = registerManagedShutdown(f.s.dataDirectory, port, () => server.shutdown(error => {
      release();
      if (error) reject(error);
      else { closed = true; resolve(); }
    }));
    t.after(release);
  });
  await assert.rejects(requestManagedShutdown(join(f.s.dataDirectory, "other-installation"), port), /未识别到/);
  const accepted = requestManagedShutdown(f.s.dataDirectory, port);
  await emptyClosed;
  assert.equal(closed, false, "the incomplete active request must retain its connection");
  let response = "";
  active.on("data", chunk => { response += chunk.toString(); });
  const completed = once(active, "close");
  active.write(body.slice(1));
  let timer;
  try {
    await Promise.race([Promise.all([stopped, completed, accepted]), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("shutdown did not complete")), 2000);
    })]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(response.split("\r\n")[0], "HTTP/1.1 200 OK");
  assert.equal(closed, true);
});
