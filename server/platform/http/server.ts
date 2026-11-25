import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from "node:http";
import type { HttpServices, RouteServices } from "./context.js";
import { isObject } from "../../shared/types/contracts.js";
import { memoryPage as page } from "./memory-page.js";
import { readBody as body } from "./request.js";
import { dispatchRoute } from "./routes.js";
import { webDirectory } from "../paths.js";
import { errorResponse } from "./error-response.js";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createAccessLogs, safeAccount, safePath, type AccessLogOptions } from "../access-logs/service.js";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { authorize } from "../auth/service.js";
import { requireValue } from "../../shared/errors/business-error.js";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};
export function httpServer(
  system: HttpServices,
  { staticDirectory = webDirectory, accessLog = {} }: { staticDirectory?: string; accessLog?: AccessLogOptions } = {},
) {
  const { auth, catalog, dashboard, demands, dictionaries, equipment, finance, funding, history, management,
    materials, organizations, priceRules, pricing, projectClosure, projects, sources, standards, exchange, evidence } = system;
  const routeServices: RouteServices = { auth, catalog, dashboard, demands, dictionaries, equipment, finance,
    funding, history, management, materials, organizations, priceRules, pricing, projectClosure, projects, sources, standards };
  const logs = createAccessLogs(system.dataDirectory, accessLog);
  const attempts = new Map<string, { count: number; until: number }>();
  let nextAttemptSweep = 0;
  function trackLogin(key: string) {
    const time = Date.now();
    if (time >= nextAttemptSweep) {
      for (const [entry, attempt] of attempts) if (attempt.until <= time) attempts.delete(entry);
      nextAttemptSweep = time + 60000;
    }
    const previous = attempts.get(key);
    const active = previous && previous.until > time ? previous : { count: 0, until: time + 60000 };
    requireValue(active.count < 10 && (previous || attempts.size < 20000),
      "登录尝试过多，请一分钟后重试", 429);
    active.count++;
    attempts.set(key, active);
  }
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
  const server = createServer(async (req, res) => {
    const started = performance.now(), requestId = randomUUID();
    const clientIp = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    let username = "", logOutcome = "", errorType = "", errorSummary = "", recorded = false;
    const path = safePath(req.url || "/");
    res.setHeader("X-Request-ID", requestId);
    function record(aborted = false) {
      if (recorded) return;
      recorded = true;
      logs.record({ request_id: requestId, ip: clientIp,
        username, method: (req.method || "GET").replace(/[^A-Z]/g, "").slice(0, 20), path,
        status: aborted ? 499 : res.statusCode, duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
        outcome: aborted ? "连接中断" : logOutcome || (res.statusCode < 400 ? "访问成功" : "访问失败"),
        error_type: errorType, error_summary: errorSummary });
    }
    res.once("finish", () => record());
    res.once("close", () => record(!res.writableFinished));
    let authenticatedActorId: string | null = null;
    let authenticatedViewer = false;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      logOutcome = "IP白名单拒绝";
      requireValue(
        system.auth.permittedIp(req.socket.remoteAddress),
        "此客户端IP尚未授权",
        403,
      );
      logOutcome = "";
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
        if (token(req)) {
          try { username = safeAccount(system.auth.actor(token(req)).username); }
          catch { /* Public application assets remain available before login. */ }
        }
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
            [".html", ".json"].includes(extname(file)) ? "no-store" : "private, max-age=3600",
        });
        res.end(method === "HEAD" ? undefined : data);
        return;
      }
      if (parts[1] === "login" && method === "POST") {
        logOutcome = "登录失败";
        const address = "ip:" + (req.socket.remoteAddress || "");
        trackLogin(address);
        const input = await body(req);
        requireValue(isObject(input), "请求正文必须为JSON对象", 400);
        username = safeAccount(input.username);
        const account = "account:" + username.toLowerCase();
        if (username) trackLogin(account);
        const result = system.auth.login(input.username, input.password, clientIp);
        username = safeAccount(result.user.username);
        logOutcome = "登录成功";
        attempts.delete(address);
        if (username) attempts.delete(account);
        json(res, 200, result.user, {
          "Set-Cookie": `sd113=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
        return;
      }
      let actor = system.auth.actor(token(req));
      username = safeAccount(actor.username);
      authenticatedActorId=actor.id;
      authenticatedViewer=actor.role==="viewer";
      if (actor.password_change_required) {
        const credentialProcedure =
          (parts.length === 2 && parts[1] === "session" && method === "GET") ||
          (parts.length === 2 && parts[1] === "logout" && method === "POST") ||
          (parts.length === 3 && parts[1] === "me" && parts[2] === "password" && method === "POST");
        requireValue(credentialProcedure, "请先更改临时密码", 403);
      }
      if (parts[1] === "training" && parts[2] === "journey" && parts.length === 3 && method === "GET") {
        json(res, 200, { scenario: system.training.journey(actor) });
        return;
      }
      if (parts[1] === "training" && parts[2] === "checkpoints" && method === "GET") {
        json(res, 200, system.training.checkpoints(actor.id));
        return;
      }
      if (parts[1] === "session" && method === "GET") {
        json(res, 200, actor);
        return;
      }
      if (parts[1] === "me") {
        const cookie = token(req);
        const expired = { "Set-Cookie": "sd113=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" };
        if (parts.length === 2 && method === "GET") json(res, 200, auth.profile(actor));
        else if (parts[2] === "sessions" && parts.length === 3 && method === "GET")
          json(res, 200, auth.sessions(actor,cookie));
        else if (parts[2] === "sessions" && parts.length === 4 && method === "DELETE") {
          const result = auth.revokeSession(actor,cookie,parts[3],clientIp);
          json(res, 200, result, result.current ? expired : {});
        } else if (parts[2] === "password" && parts.length === 3 && method === "POST") {
          const input = await body(req);
          requireValue(isObject(input), "请求正文必须为JSON对象", 400);
          const result = auth.changeOwnPassword(system.auth.actor(cookie),input.current_password,input.new_password,clientIp);
          logOutcome = "修改密码";
          json(res, 200, result, expired);
        } else requireValue(false,"个人账号接口不存在",404);
        return;
      }
      if (parts[1] === "logout" && method === "POST") {
        system.auth.logout(token(req));
        logOutcome = "退出登录";
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
      if (parts[1] === "access-logs") {
        authorize(actor, "admin");
        requireValue(method === "GET", "请求方法无效", 405);
        if (parts.length === 2) json(res, 200, await logs.query(url.searchParams));
        else {
          requireValue(parts.length === 3 && parts[2] === "export", "接口不存在", 404);
          logs.validate(url.searchParams);
          res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("访问日志.jsonl")}` });
          async function* lines() {
            for await (const row of logs.records(url.searchParams)) yield JSON.stringify(row) + "\n";
          }
          await pipeline(Readable.from(lines()), res);
        }
        return;
      }
      const input = ["GET", "HEAD"].includes(method) ? {} : await body(req);
      if (!["GET", "HEAD"].includes(method)) actor = system.auth.actor(token(req));
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
      const outcome = await dispatchRoute({ system: routeServices, actor, resource, read, key, sub, subKey, action,
        method, input, deleted, url, req, res, mutate, workbook, page, exchange, evidence });
      if (outcome) json(res, 200, outcome.result);
    } catch (error) {
      const failure = errorResponse(error);
      if (failure.status === 429) logOutcome = "登录限流";
      else if (!logOutcome && failure.status === 401) logOutcome = "未登录访问";
      else if (!logOutcome && failure.status === 403) logOutcome = "权限不足";
      else if (!logOutcome) logOutcome = "访问失败";
      errorType = failure.status === 500 ? "InternalError" : failure.body.code;
      errorSummary = ({ 400: "请求格式错误", 401: "认证失败", 403: "访问被拒绝", 404: "资源不存在",
        409: "业务版本或状态冲突", 429: "请求频率受限", 500: "服务内部错误" } as Record<number, string>)[failure.status] || "请求未通过业务校验";
      // Evidence is recorded only after a real authenticated viewer's forbidden
      // business write (not a forged client claim, login/IP denial or tour click).
      if (failure.status===403 && authenticatedActorId && authenticatedViewer &&
          !["GET","HEAD"].includes(req.method||"GET"))
        system.training.record(authenticatedActorId,"forbidden");
      if (failure.status === 500) console.error("HTTP_INTERNAL_ERROR", requestId);
      if (res.headersSent) res.destroy();
      else json(res, failure.status, failure.body);
    }
  });
  const pendingConnections = new Set<Socket>();
  server.on("connection", socket => {
    pendingConnections.add(socket);
    socket.once("data", () => pendingConnections.delete(socket));
    socket.once("close", () => pendingConnections.delete(socket));
  });
  server.once("close", () => logs.close());
  return Object.assign(server, {
    shutdown(callback: (error?: Error) => void) {
      server.close(callback);
      for (const socket of pendingConnections)
        if (socket.bytesRead === 0) socket.destroy();
    },
  });
}
