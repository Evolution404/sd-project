import { authorize, id, now } from "../../platform/auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { IdentityRepository } from "../../database/repositories/identity.js";
import type { ManagementRepository } from "../../database/repositories/management.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Database } from "../../database/connection.js";
import type { createAuth } from "../../platform/auth/service.js";

type AuthService = ReturnType<typeof createAuth>;
interface Dependencies {
  repository: ManagementRepository;
  identity: IdentityRepository;
  auth: AuthService;
  audit: AuditService;
  database: Pick<Database, "transaction">;
}
interface UserInput {
  username: string;
  password?: string;
  role: "admin" | "editor" | "verifier" | "viewer";
  status?: string;
}
type Input = Record<string, unknown>;

/** System-administration application use cases; no SQL or generic table CRUD. */
export function createManagement({ repository, identity, auth, audit, database }: Dependencies) {
  function actors(actor: Actor, includeHistorical = false) {
    authorize(actor, "read");
    const deleted = repository.deletedUserIds();
    return identity.users()
      .filter(user => includeHistorical || (user.status === "active" && !deleted.has(user.id)))
      .map(({ id, username }) => ({ id, username }));
  }
  function users(actor: Actor, includeDeleted = false) {
    authorize(actor, "admin");
    const deleted = repository.deletedUserIds();
    return identity.users()
      .filter(user => includeDeleted || !deleted.has(user.id))
      .map(user => ({ ...user, deleted: deleted.has(user.id) }));
  }
  function saveUser(actor: Actor, input: Input, key?: string, method?: string) {
    authorize(actor, "admin");
    return database.transaction(() => {
      requireValue(!key || !repository.isUserDeleted(key), "用户已删除", 409);
      const current = key ? identity.users().find(user => user.id === key) : undefined;
      if (key) requireValue(current, "用户不存在", 404);
      if (method === "DELETE") requireValue(key, "未指定要删除的用户", 422);
      const output = method === "DELETE"
        ? auth.saveUser(actor, { username: current!.username, role: current!.role, status: "disabled" }, key)
        : auth.saveUser(actor, input as unknown as UserInput, key);
      requireValue(output, "用户变更未完成", 409);
      audit.record(actor, "users", key || output.id,
        method === "DELETE" ? "delete" : key ? "revise" : "create",
        current ?? null, method === "DELETE" ? { logical: true } : output);
      return output;
    });
  }
  function accessPolicy(actor:Actor) {
    authorize(actor,"admin");
    return repository.accessPolicy();
  }
  function setAccessPolicy(actor:Actor,input:Input) {
    authorize(actor,"admin");
    requireValue(typeof input.ip_restriction_enabled==="boolean",
      "访问限制开关必须明确为开启或关闭");
    requireValue(typeof input.expected_version==="number" &&
      Number.isSafeInteger(input.expected_version) && input.expected_version>0,
      "请提供访问限制配置的当前版本");
    return database.transaction(()=>{
      const original=repository.accessPolicy();
      requireValue(original.version===input.expected_version,
        "访问控制配置已被其他管理员修改，请刷新后重试",409);
      requireValue(original.ip_restriction_enabled!==input.ip_restriction_enabled,
        "访问控制配置没有变化",409);
      const enabled=input.ip_restriction_enabled as boolean;
      const changed=repository.updateAccessPolicy(original.version,enabled,actor.id,now());
      requireValue(changed,"访问控制配置已变更，请刷新后重试",409);
      const updated=repository.accessPolicy();
      audit.record(actor,"access_policy","ip_restriction","revise",original,updated);
      return updated;
    });
  }
  function ips(actor: Actor) {
    authorize(actor, "admin");
    return repository.allowedIps();
  }
  function saveIp(actor: Actor, input: Input, key?: string, method?: string) {
    authorize(actor, "admin");
    return database.transaction(() => {
      const original = key ? repository.allowedIp(key) : undefined;
      if (key) requireValue(original, "IP授权不存在", 404);
      if (method === "DELETE") {
        requireValue(key && original, "IP授权不存在", 404);
        audit.record(actor, "ips", key, "delete", original, { deleted: true });
        repository.removeIp(key);
        return { deleted: true };
      }
      const values = {
        ip: auth.validateIp(text(input.ip, "IP地址")),
        note: typeof input.note === "string" ? input.note : "",
      };
      const configId = key || id();
      if (key) repository.updateIp(key, values);
      else repository.insertIp({
        id: configId, ...values, created_by: actor.id, created_at: now(),
      });
      audit.record(actor, "ips", configId,
        key ? "revise" : "create", original ?? null, values);
      return { ok: true };
    });
  }
  function audits(actor: Actor, includeDeleted: boolean, key: string): { original: NonNullable<ReturnType<ManagementRepository["auditRecord"]>>; decisions: ReturnType<AuditService["history"]> };
  function audits(actor: Actor, includeDeleted?: boolean, key?: undefined): ReturnType<ManagementRepository["auditEvents"]>;
  function audits(actor: Actor, includeDeleted = false, key?: string) {
    authorize(actor, "admin");
    if (key) {
      const original = repository.auditRecord(key);
      requireValue(original, "审计记录不存在", 404);
      return { original, decisions: audit.history("audit", key) };
    }
    return repository.auditEvents(includeDeleted);
  }
  function searchAuditEvents(actor: Actor, query: Parameters<ManagementRepository["searchAuditEvents"]>[0]) {
    authorize(actor, "admin");
    return repository.searchAuditEvents(query);
  }
  function annotateAudit(actor: Actor, input: Input, key?: string, method?: string) {
    authorize(actor, "admin");
    return database.transaction(() => {
      if (key) {
        requireValue(repository.auditRecord(key), "审计记录不存在", 404);
        audit.record(actor, "audit", key, method === "DELETE" ? "delete" : "correct",
          null, method === "DELETE"
            ? { logical: true }
            : { message: typeof input.message === "string" ? input.message : "" });
      } else {
        requireValue(method !== "DELETE", "未指定审计记录", 422);
        audit.record(actor, "manual", id(), "note", null, {
          message: typeof input.message === "string" ? input.message : "",
        });
      }
      return { ok: true };
    });
  }
  function permissions(actor: Actor) {
    authorize(actor, "admin");
    return repository.permissionCatalog();
  }
  return { actors, users, saveUser, accessPolicy, setAccessPolicy, ips, saveIp, audits, searchAuditEvents, annotateAudit, permissions };
}
export type ManagementService = ReturnType<typeof createManagement>;
