import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { authorize } from "../application/auth.mjs";
import { requireValue } from "../domain/errors.mjs";
import { createEvidence } from "../application/evidence.mjs";
import { createExchange } from "../exchange/service.mjs";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export function httpServer(
  system,
  { staticDirectory = resolve(import.meta.dirname, "../../dist/web") } = {},
) {
  const exchange = createExchange(system),
    evidence = createEvidence(system),
    attempts = new Map();
  const token = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("sd113="))
      ?.slice(6) || "";
  function json(response, status, body, headers = {}) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    response.end(JSON.stringify(body));
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      requireValue(size <= 17 * 1024 * 1024, "请求超过大小限制", 413);
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (
      req.headers["content-type"] ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
      return buffer;
    requireValue(
      (req.headers["content-type"] || "").startsWith("application/json") ||
        !buffer.length,
      "请求类型无效",
      415,
    );
    try {
      const value = buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
      requireValue(
        value && typeof value === "object" && !Array.isArray(value),
        "请求正文必须为JSON对象",
        400,
      );
      return value;
    } catch {
      requireValue(false, "JSON格式错误", 400);
    }
  }
  function page(rows, search) {
    const query = search.get("q") || "",
      sort = search.get("sort") || "created_at",
      direction = search.get("direction") === "asc" ? 1 : -1;
    const filtered = rows
      .filter((row) => !query || JSON.stringify(row).includes(query))
      .sort(
        (a, b) =>
          String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), "zh-CN", {
            numeric: true,
          }) * direction,
      );
    const index = Math.max(1, Number(search.get("page")) || 1),
      size = Math.min(200, Math.max(1, Number(search.get("page_size")) || 30));
    return {
      items: filtered.slice((index - 1) * size, index * size),
      total: filtered.length,
      page: index,
      page_size: size,
    };
  }
  async function workbook(response, promise, filename) {
    const buffer = await promise;
    response.writeHead(200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Cache-Control": "no-store",
    });
    response.end(buffer);
  }
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      requireValue(
        system.auth.permittedIp(req.socket.remoteAddress),
        "此客户端IP尚未授权",
        403,
      );
      const url = new URL(req.url, "http://localhost"),
        parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent),
        method = req.method;
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
        const address = req.socket.remoteAddress,
          last = attempts.get(address) || { count: 0, until: 0 };
        if (last.until < Date.now()) {
          last.count = 0;
          last.until = Date.now() + 60000;
        }
        requireValue(last.count < 10, "登录尝试过多，请一分钟后重试", 429);
        last.count++;
        attempts.set(address, last);
        const input = await body(req),
          result = system.auth.login(input.username, input.password);
        attempts.delete(address);
        json(res, 200, result.user, {
          "Set-Cookie": `sd113=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
        return;
      }
      const actor = system.auth.actor(token(req));
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
      const [_, resource, key, sub, subKey, action] = parts;
      const read = method === "GET",
        deleted = url.searchParams.get("deleted") === "true";
      let result;
      function mutate(permission, operation) {
        authorize(actor, permission);
        return system.idempotent(
          actor,
          req.headers["idempotency-key"],
          { method, path: url.pathname, input },
          operation,
        );
      }
      switch (resource) {
        case "actors":
          requireValue(read, "请求方法无效", 405);
          result = system.management.actors(
            actor,
            url.searchParams.get("history") === "true",
          );
          break;
        case "dashboard":
          requireValue(read, "请求方法无效", 405);
          result = system.dashboard(actor);
          break;
        case "catalogs":
          requireValue(read, "请求方法无效", 405);
          result = system.catalog.definitions;
          break;
        case "catalog":
          if (read)
            result =
              sub === "history"
                ? system.catalog.history(key, subKey)
                : sub
                  ? system.catalog.get(key, sub, deleted)
                  : page(system.catalog.list(key, deleted), url.searchParams);
          else if (method === "DELETE")
            result = mutate("admin", () =>
              system.catalog.remove(actor, key, sub, input.expected_version),
            );
          else
            result = mutate(
              ["frameworks", "agreements"].includes(key) ? "write" : "admin",
              () => system.catalog.save(actor, key, input, sub),
            );
          break;
        case "demands":
          if (read)
            result = !key
              ? page(system.demands.list(deleted), url.searchParams)
              : sub === "history"
                ? system.demands.history(key)
                : system.demands.get(key, deleted);
          else if (method === "DELETE")
            result = mutate("admin", () =>
              system.demands.remove(actor, key, input),
            );
          else if (sub === "status")
            result = mutate("demand.activate", () =>
              system.demands.transition(actor, key, input),
            );
          else if (sub === "quote")
            result = input.confirm
              ? mutate("write", () => system.pricing.quote(actor, key, input))
              : system.pricing.quote(actor, key, input);
          else
            result = mutate("write", () =>
              system.demands.save(actor, input, key),
            );
          break;
        case "projects":
          if (read)
            result = !key
              ? page(system.projects.list(deleted), url.searchParams)
              : sub === "history"
                ? system.projects.history(key)
                : sub === "summary"
                  ? system.finance.summary(key)
                  : sub === "costs" && subKey
                    ? system.finance.costHistory(subKey)
                    : sub === "costs"
                      ? page(
                          system.finance.costs(key, deleted),
                          url.searchParams,
                        )
                      : sub === "settlements"
                        ? page(
                            system.finance.settlements(key),
                            url.searchParams,
                          )
                        : system.projects.get(key, deleted);
          else if (method === "DELETE" && !sub)
            result = mutate("admin", () =>
              system.projects.remove(actor, key, input),
            );
          else if (sub === "stock")
            result = mutate("project.stock", () =>
              system.projects.stock(actor, key, input),
            );
          else if (sub === "link")
            result = mutate("write", () =>
              system.projects.link(actor, key, input),
            );
          else if (sub === "release")
            result = mutate("write", () =>
              system.projects.release(actor, key, subKey, input),
            );
          else if (sub === "funding")
            result = mutate("write", () =>
              system.projects.fund(actor, key, input),
            );
          else if (sub === "approvals" && method === "DELETE")
            result = mutate("write", () =>
              system.projects.discardApproval(actor, key, subKey),
            );
          else if (sub === "approvals" && action === "approve")
            result = mutate(
              system.projects.get(key).approval
                ? "change.approve"
                : "project.approve",
              () => system.projects.approve(actor, key, subKey, input),
            );
          else if (sub === "approvals")
            result = mutate("write", () =>
              system.projects.approvalDraft(actor, key, input),
            );
          else if (sub === "nodes" && method === "DELETE")
            result = mutate("admin", () =>
              system.finance.removeNode(actor, key, subKey, input),
            );
          else if (sub === "costs" && method === "DELETE")
            result = mutate("admin", () =>
              system.finance.removeCost(actor, key, subKey, input),
            );
          else if (sub === "nodes")
            result = mutate("write", () =>
              system.finance.node(actor, key, input, subKey),
            );
          else if (sub === "costs")
            result = mutate("cost.confirm", () =>
              system.finance.cost(actor, key, input, subKey),
            );
          else if (sub === "settlements")
            result = mutate("write", () =>
              system.finance.saveDraft(actor, key, input, subKey),
            );
          else if (sub === "close")
            result = mutate("project.close", () =>
              system.finance.close(actor, key, input),
            );
          else
            result = mutate("write", () =>
              system.projects.save(actor, input, key),
            );
          break;
        case "settlements":
          if (read)
            result = !key
              ? page(system.finance.allSettlements(deleted), url.searchParams)
              : sub === "history"
                ? system.finance.history(key)
                : system.finance.settlement(key);
          else if (method === "DELETE" && !sub)
            result = mutate("admin", () =>
              system.finance.removeSettlement(actor, key, input),
            );
          else if (sub === "submit")
            result = mutate("write", () =>
              system.finance.submit(actor, key, input),
            );
          else if (sub === "review")
            result = mutate("settlement.approve", () =>
              system.finance.review(actor, key, input),
            );
          else if (sub === "draft" && method === "DELETE")
            result = mutate("write", () =>
              system.finance.discardDraft(actor, key, input),
            );
          else requireValue(false, "结算动作不存在", 404);
          break;
        case "reconciliations":
          if (read)
            result = key
              ? system.finance.reconciliationHistory(key)
              : page(
                  system.finance.reconciliations(
                    url.searchParams.get("project_id"),
                    deleted,
                  ),
                  url.searchParams,
                );
          else if (method === "DELETE")
            result = mutate("cost.confirm", () =>
              system.finance.removeReconciliation(actor, key, input),
            );
          else
            result = mutate("cost.confirm", () =>
              system.finance.reconciliation(actor, input),
            );
          break;
        case "charges":
          result = mutate("write", () =>
            key
              ? method === "DELETE"
                ? system.pricing.removeCharge(actor, key)
                : system.pricing.reviseCharge(actor, key, input)
              : system.pricing.addCharge(actor, input),
          );
          break;
        case "exchange":
          if (sub === "template") {
            await workbook(
              res,
              exchange.template(actor, key, url.searchParams.get("project_id")),
              `${key}-template`,
            );
            return;
          }
          if (sub === "export") {
            await workbook(
              res,
              exchange.exportData(actor, key, {
                ids: url.searchParams.getAll("id"),
                projectId: url.searchParams.get("project_id"),
                query: url.searchParams.get("q") || "",
                report: url.searchParams.get("report") === "true",
              }),
              `${key}-export`,
            );
            return;
          }
          if (sub === "preview") {
            requireValue(Buffer.isBuffer(input), "请上传xlsx文件");
            result = await exchange.preview(actor, key, input, {
              mode: url.searchParams.get("mode") || "mixed",
              projectId: url.searchParams.get("project_id"),
            });
          } else if (sub === "commit")
            result = exchange.commit(actor, key, input);
          else if (sub === "results" && read) {
            await workbook(res, exchange.results(actor, key), "import-results");
            return;
          } else if (sub === "errors") {
            await workbook(res, exchange.errors(actor, key), "issues");
            return;
          } else requireValue(false, "交换动作不存在", 404);
          break;
        case "sources":
          if (read) result = system.sources.history(key);
          else if (method === "DELETE")
            result = mutate("admin", () => system.sources.remove(actor, key));
          else
            result = mutate("write", () =>
              system.sources.revise(actor, key, input),
            );
          break;
        case "evidence":
          if (read && key) {
            const { file, bytes } = evidence.download(actor, key);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
              "Cache-Control": "no-store",
            });
            res.end(bytes);
            return;
          }
          if (read)
            result = evidence.list(
              actor,
              url.searchParams.get("owner_kind"),
              url.searchParams.get("owner_id"),
              deleted,
            );
          else if (method === "DELETE")
            result = mutate("admin", () => evidence.remove(actor, key));
          else if (key)
            result = mutate("write", () =>
              evidence.revise(actor, key, input.note),
            );
          else result = mutate("write", () => evidence.upload(actor, input));
          break;
        case "users":
          authorize(actor, "admin");
          result = read
            ? page(system.management.users(actor, deleted), url.searchParams)
            : mutate("admin", () =>
                system.management.saveUser(actor, input, key, method),
              );
          break;
        case "ips":
          authorize(actor, "admin");
          result = read
            ? page(system.management.ips(actor), url.searchParams)
            : mutate("admin", () =>
                system.management.saveIp(actor, input, key, method),
              );
          break;
        case "audit":
          authorize(actor, "admin");
          result = read
            ? key
              ? system.management.audits(actor, deleted, key)
              : page(system.management.audits(actor, deleted), url.searchParams)
            : mutate("admin", () =>
                system.management.annotateAudit(actor, input, key, method),
              );
          break;
        case "permissions":
          authorize(actor, "admin");
          requireValue(read, "权限定义只读", 405);
          result = system.management.permissions(actor);
          break;
        default:
          requireValue(false, "接口不存在", 404);
      }
      json(res, 200, result);
    } catch (error) {
      const integrity =
        /constraint|UNIQUE|FOREIGN KEY|不可|必须|不能|禁止|不得|拒绝|已关联/.test(
          error.message,
        );
      const status = error.status || (integrity ? 422 : 500);
      if (status === 500) console.error(error);
      json(res, status, {
        message:
          status === 500
            ? "服务内部错误"
            : /UNIQUE constraint failed/.test(error.message)
              ? "编号或唯一业务标识已存在，请刷新核对"
              : /FOREIGN KEY constraint failed/.test(error.message)
                ? "关联记录不存在或仍被引用，请刷新核对"
                : /(?:CHECK|NOT NULL) constraint failed/.test(error.message)
                  ? "填写内容不符合业务约束，请检查必填值和范围"
                  : error.message,
        fields: error.fields || {},
      });
    }
  });
}
