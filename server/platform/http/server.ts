import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from "node:http";
import type { System } from "../../bootstrap.js";
import { isObject } from "../../shared/types/contracts.js";
import { memoryPage as page } from "./memory-page.js";
import { readBody as body } from "./request.js";
import { dispatchRoute } from "./routes.js";
import { webDirectory } from "../paths.js";
import { errorResponse } from "./error-response.js";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { authorize } from "../auth/service.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { createEvidence } from "../files/service.js";
import { createExchange } from "../../modules/exchange/service.js";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export function httpServer(
  system: System,
  { staticDirectory = webDirectory } = {},
) {
  const exchange = createExchange(system),
    evidence = createEvidence(system),
    attempts = new Map<string, { count: number; until: number }>();
  const token = (req: IncomingMessage) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("sd113="))
      ?.slice(6) || "";
  function json(response: ServerResponse, status: number, body: unknown, headers: OutgoingHttpHeaders = {}) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    response.end(JSON.stringify(body));
  }
  async function workbook(response: ServerResponse, promise: Promise<unknown>, filename: string) {
    const buffer = await promise;
    requireValue(buffer instanceof Uint8Array, "工作簿生成失败");
    response.writeHead(200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename + '.xlsx')}`,
      "Cache-Control": "no-store",
    });
    response.end(buffer);
  }
  return createServer(async (req, res) => {
    let authenticatedActorId: string | null = null;
    let authenticatedViewer = false;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      requireValue(
        system.auth.permittedIp(req.socket.remoteAddress),
        "此客户端IP尚未授权",
        403,
      );
      const url = new URL(req.url || "/", "http://localhost"),
        parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent),
        method = req.method || "GET";
      if (!["GET", "HEAD"].includes(method) && req.headers.origin) {
        requireValue(
          new URL(req.headers.origin).host === req.headers.host,
          "请求来源无效",
          403,
        );
      }
      if (parts[0] !== "api") {
        requireValue(["GET", "HEAD"].includes(method), "请求方法无效", 405);
        const root = resolve(staticDirectory),
          requested = resolve(root, "." + url.pathname);
        requireValue(
          requested === root || requested.startsWith(root + sep),
          "路径无效",
          403,
        );
        let file = requested;
        try {
          if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
        } catch {
          file = resolve(root, "index.html");
        }
        requireValue(Boolean(mime[extname(file)]), "资源不存在", 404);
        const data = await readFile(file);
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
          "Cache-Control":
            extname(file) === ".html" ? "no-store" : "private, max-age=3600",
        });
        res.end(method === "HEAD" ? undefined : data);
        return;
      }
      if (parts[1] === "login" && method === "POST") {
        const address = req.socket.remoteAddress || "",
          last = attempts.get(address) || { count: 0, until: 0 };
        if (last.until < Date.now()) {
          last.count = 0;
          last.until = Date.now() + 60000;
        }
        requireValue(last.count < 10, "登录尝试过多，请一分钟后重试", 429);
        last.count++;
        attempts.set(address, last);
        const input = await body(req);
        requireValue(isObject(input), "请求正文必须为JSON对象", 400);
        const result = system.auth.login(input.username, input.password);
        attempts.delete(address);
        json(res, 200, result.user, {
          "Set-Cookie": `sd113=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
        return;
      }
      const actor = system.auth.actor(token(req));
      authenticatedActorId=actor.id;
      authenticatedViewer=actor.role==="viewer";
      if (parts[1] === "training" && parts[2] === "checkpoints" && method === "GET") {
        json(res, 200, system.training.checkpoints(actor.id));
        return;
      }
      if (parts[1] === "session" && method === "GET") {
        json(res, 200, actor);
        return;
      }
      if (parts[1] === "logout" && method === "POST") {
        system.auth.logout(token(req));
        json(
          res,
          200,
          { ok: true },
          {
            "Set-Cookie":
              "sd113=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        );
        return;
      }
      const input = ["GET", "HEAD"].includes(method) ? {} : await body(req);
      const [, resource = "", key = "", sub = "", subKey = "", action = ""] = parts;
      const read = method === "GET",
        deleted = url.searchParams.get("deleted") === "true";
      function mutate<T>(permission: string, operation: () => T): T {
        authorize(actor, permission);
        return system.idempotent(
          actor,
          req.headers["idempotency-key"],
          { method, path: url.pathname, input },
          operation,
        );
      }
      const outcome = await dispatchRoute({ system, actor, resource, read, key, sub, subKey, action,
        method, input, deleted, url, req, res, mutate, workbook, page, exchange, evidence });
      if (outcome) json(res, 200, outcome.result);
      if (system.training.enabled && resource==="exchange" &&
          outcome && isObject(outcome.result)) {
        const result=outcome.result;
        if (sub==="preview" && key==="demands" && typeof result.token==="string" && isObject(result.summary)) {
          const hasIssues=Array.isArray(result.issues) && result.issues.length>0;
          system.training.record(actor.id,
            hasIssues?"excel_invalid_preview":"excel_valid_preview",result.token);
        }
        if (sub==="commit" && result.kind==="demands" && Array.isArray(result.results) &&
            result.results.some(entry=>isObject(entry) &&
              (entry.action==="create"||entry.action==="update")))
          system.training.record(actor.id,"excel_commit",key);
      }
    } catch (error) {
      const failure = errorResponse(error);
      // Evidence is recorded only after a real authenticated viewer's forbidden
      // business write (not a forged client claim, login/IP denial or tour click).
      if (failure.status===403 && authenticatedActorId && authenticatedViewer &&
          !["GET","HEAD"].includes(req.method||"GET"))
        system.training.record(authenticatedActorId,"forbidden");
      if (failure.status === 500) console.error(error);
      json(res, failure.status, failure.body);
    }
  });
}
