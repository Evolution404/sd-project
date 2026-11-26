import { randomBytes } from "node:crypto";
import { versionedEntryBatch } from "../../platform/versioned-entry-batch.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
import { optNum } from "../../shared/input-shape.js";
import { isObject, type Actor } from "../../shared/types/contracts.js";
import { scopedProjectPermissions, type ProjectRoleScope } from "../../shared/types/project-access.js";
import type { IdentityRepository } from "../../database/repositories/identity.js";
import type { ManagementRepository } from "../../database/repositories/management.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Database } from "../../database/connection.js";
import type { createAuth } from "../../platform/auth/service.js";
import { authorizedMenuRoutes } from "./menu.js";

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
  role?: "admin" | "editor" | "verifier" | "viewer";
  role_codes?: string[];
  display_name?: string;
  employee_no?: string | null;
  primary_org_id?: string | null;
  organization_ids?: string[];
  expected_version?: number;
  status?: string;
}
type Input = Record<string, unknown>;

/** System-administration application use cases; no SQL or generic table CRUD. */
export function createManagement({ repository, identity, auth, audit, database }: Dependencies) {
  function menuRoutes(actor:Actor) {
    // A user only sees modules authorized by effective persisted grants.
    return authorizedMenuRoutes(actor);
  }
  function actors(actor: Actor, includeHistorical = false) {
    authorize(actor, "read");
    const deleted = repository.deletedUserIds();
    return identity.users()
      .filter(user => includeHistorical || (user.status === "active" && !deleted.has(user.id)))
      .map(({ id, username }) => ({ id, username }));
  }
  function users(actor: Actor, includeDeleted = false) {
    authorize(actor, "user.manage");
    const deleted = repository.deletedUserIds();
    return identity.users()
      .filter(user => includeDeleted || !deleted.has(user.id))
      .map(user => ({ ...user, role_codes: identity.rolesForUser(user.id),
        organization_ids:identity.organizationsForUser(user.id),deleted: deleted.has(user.id) }));
  }
  function userRoleOptions(actor: Actor) {
    authorize(actor, "user.manage");
    return identity.roles().filter(role => role.status === "active")
      .map(role => ({ label: role.name, value: role.code }));
  }
  function userDetail(actor: Actor, key: string, includeDeleted = false) {
    authorize(actor, "user.manage");
    const user = identity.user(key);
    const deleted = repository.isUserDeleted(key);
    requireValue(user && (includeDeleted || !deleted), "用户不存在", 404);
    return { ...user, role_codes: identity.rolesForUser(user.id),
      organization_ids: identity.organizationsForUser(user.id), deleted };
  }
  function saveUser(actor: Actor, input: Input, key?: string, method?: string, temporaryPassword = false) {
    authorize(actor, "user.manage");
    return database.transaction(() => {
      requireValue(!key || !repository.isUserDeleted(key), "用户已删除", 409);
      const current = key ? identity.user(key) : undefined;
      if (key) requireValue(current, "用户不存在", 404);
      if (method === "DELETE") requireValue(key, "未指定要删除的用户", 422);
      const output = method === "DELETE"
        ? auth.saveUser(actor, { username: current!.username, status: "disabled",
          expected_version: optNum(input.expected_version,"用户版本") ?? current!.version }, key)
        : auth.saveUser(actor, input as unknown as UserInput, key, temporaryPassword);
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
      return { ok: true, id: configId };
    });
  }
  function entryBatch(actor: Actor, kind: "users" | "ips", input: Input, commit: boolean) {
    if (kind === "users") return versionedEntryBatch(actor, kind, input, {
      permission: "user.manage", transaction: database.transaction,
      createFields: ["username", "display_name", "employee_no"],
      updateFields: ["display_name", "employee_no", "expected_version"],
      save: row => {
        const args = {
          display_name: text(row.values.display_name, "姓名"),
          employee_no: typeof row.values.employee_no === "string" ? row.values.employee_no.trim() || null : null,
        };
        if (row.id) {
          const current = userDetail(actor, row.id);
          return saveUser(actor, { ...args, username: current.username, expected_version: row.values.expected_version }, row.id).id;
        }
        const username = text(row.values.username, "账号").trim();
        requireValue(!identity.users().some(user => user.username === username), "账号已存在", 409, { username: "账号重复" });
        // Bulk registration only stages disabled profiles. The existing explicit
        // password reset and activation flow is required before first login.
        return saveUser(actor, { ...args, username, status: "disabled",
          password: randomBytes(24).toString("base64url") }, undefined, undefined, true).id;
      },
    }, commit);
    authorize(actor, "admin");
    const policy = repository.accessPolicy();
    return versionedEntryBatch(actor, kind + ":" + policy.version, input, {
      permission: "admin", transaction: database.transaction,
      createFields: ["ip", "note"],
      updateFields: ["note", "expected_snapshot"],
      revisionGuard: values => typeof values.expected_snapshot === "string" && values.expected_snapshot.length > 0,
      save: row => {
        const note = row.values.note;
        requireValue(typeof note === "string" && note.length <= 1000, "用途说明须为 1000 字以内的文本", 422, { note: "用途说明无效" });
        const current = row.id ? repository.allowedIp(row.id) : undefined;
        if (row.id) requireValue(current && JSON.stringify([current.ip, current.note, current.created_at]) === row.values.expected_snapshot,
          "IP 授权已变化，请重新从授权列表选择", 409);
        const ip = current?.ip || auth.validateIp(text(row.values.ip, "IP 地址").trim());
        if (!row.id) requireValue(!repository.allowedIps().some(grant => grant.ip === ip), "IP 地址已授权", 409, { ip: "地址重复" });
        const result = saveIp(actor, { ip, note }, row.id);
        requireValue(result.id, "IP 授权保存失败");
        return result.id;
      },
    }, commit);
  }
  function audits(actor: Actor, includeDeleted: boolean, key: string): { original: NonNullable<ReturnType<ManagementRepository["auditRecord"]>>; decisions: ReturnType<AuditService["history"]> };
  function audits(actor: Actor, includeDeleted?: boolean, key?: undefined): ReturnType<ManagementRepository["auditEvents"]>;
  function audits(actor: Actor, includeDeleted = false, key?: string) {
    authorize(actor, "audit.read");
    if (key) {
      const original = repository.auditRecord(key);
      requireValue(original, "审计记录不存在", 404);
      return { original, decisions: audit.history("audit", key) };
    }
    return repository.auditEvents(includeDeleted);
  }
  function searchAuditEvents(actor: Actor, query: Parameters<ManagementRepository["searchAuditEvents"]>[0]) {
    authorize(actor, "audit.read");
    return repository.searchAuditEvents(query);
  }
  function searchSecurityEvents(actor: Actor, query: Parameters<ManagementRepository["searchSecurityEvents"]>[0]) {
    authorize(actor, "audit.read");
    return repository.searchSecurityEvents(query);
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
  /** Authoritative role records and their editable granted permissions. */
  function roles(actor:Actor) {
    authorize(actor,"role.manage");
    return identity.roles().map(role=>({
      ...role,
      permissions:identity.permissionsForRole(role.code),
    }));
  }
  function role(actor:Actor,code:string) {
    authorize(actor,"role.manage");
    const record=identity.role(code);
    requireValue(record,"角色不存在",404);
    return {...record,permissions:identity.permissionsForRole(code),
      data_scopes:identity.scopesForRole(code),member_count:identity.roleMemberCount(code)};
  }
  function saveRole(actor:Actor,input:Input,code?:string) {
    authorize(actor,"role.manage");
    return database.transaction(()=>{
      const at=now();
      const current=code?identity.role(code):undefined;
      if(code)requireValue(current,"角色不存在",404);
      const roleCode=code||text(input.code,"角色编码");
      requireValue(/^[a-z][a-z0-9_.-]{2,63}$/.test(roleCode),"角色编码只能使用小写字母、数字、横线和下划线");
      const name=text(input.name,"角色名称");
      const status=input.status??current?.status??"active";
      requireValue(status==="active"||status==="disabled","角色状态无效");
      const sortOrder=input.sort_order??current?.sort_order??100;
      requireValue(typeof sortOrder==="number"&&Number.isSafeInteger(sortOrder),"排序必须为整数");
      const auto=input.auto_grant_new_permissions??Boolean(current?.auto_grant_new_permissions);
      requireValue(typeof auto==="boolean","自动授予新权限设置无效");
      if(!current) {
        requireValue(!identity.role(roleCode),"角色编码已存在",409);
        identity.createRole({code:roleCode,name,status,sort_order:sortOrder,
          system_seed:0,auto_grant_new_permissions:Number(auto),version:1,
          created_at:at,updated_at:at});
      } else {
        requireValue(input.expected_version===current.version,
          "角色版本已变化，请刷新后重试",409);
        identity.updateRole(roleCode,{name,status,sort_order:sortOrder,
          auto_grant_new_permissions:Number(auto),version:current.version+1,updated_at:at});
      }
      requireValue(identity.hasAdministrator(),"必须保留一个有效管理员（具有系统管理授权）",409);
      if(current)identity.revokeRoleMembers(roleCode);
      const output={...identity.role(roleCode)!,permissions:identity.permissionsForRole(roleCode)};
      audit.record(actor,"roles",roleCode,current?"revise":"create",current||null,output);
      return output;
    });
  }
  function deleteRole(actor:Actor,code:string,input:Input) {
    authorize(actor,"role.manage");
    return database.transaction(()=>{
      const original=identity.role(code);
      requireValue(original,"角色不存在",404);
      requireValue(!original.system_seed,"内置角色不允许删除，权限可以编辑",409);
      requireValue(input.expected_version===original.version,
        "角色版本已变化，请刷新后重试",409);
      requireValue(identity.roleMemberCount(code)===0,
        "角色仍有关联账号，先调整用户角色",409);
      const grants=identity.permissionsForRole(code);
      identity.deleteRole(code);
      requireValue(identity.hasAdministrator(),"必须保留一个有效管理员（具有系统管理授权）",409);
      audit.record(actor,"roles",code,"delete",{...original,permissions:grants},{deleted:true});
      return {deleted:true};
    });
  }
  function setRolePermissions(actor:Actor,roleCode:string,input:Input) {
    authorize(actor,"role.manage");
    requireValue(Array.isArray(input.permissions)&&input.permissions.every(x=>typeof x==="string"),
      "角色权限必须是字符串列表");
    const codes=input.permissions as string[];
    requireValue(new Set(codes).size===codes.length,"角色权限不能重复");
    requireValue(codes.every(code=>identity.allPermissions().includes(code)),"包含未经服务端注册的权限");
    return database.transaction(()=>{
      const original=identity.role(roleCode);
      requireValue(original,"角色不存在",404);
      requireValue(input.expected_version===original.version,
        "角色权限版本已被其他管理员修改，请刷新后重试",409);
      const previous=identity.permissionsForRole(roleCode);
      const previousScopes = identity.scopesForRole(roleCode);
      const scopes = input.data_scopes === undefined
        ? previousScopes.filter(scope => codes.includes(scope.permission_code))
        : parseProjectScopes(input.data_scopes, codes, previousScopes);
      identity.setRolePermissions(roleCode,codes);
      identity.replaceRoleScopes(roleCode, scopes);
      requireValue(identity.hasAdministrator(),"必须保留一个有效管理员（具有系统管理授权）",409);
      identity.updateRole(roleCode,{version:original.version+1,updated_at:now()});
      identity.revokeRoleMembers(roleCode);
      const output=role(actor, roleCode);
      audit.record(actor,"roles",roleCode,"permission_grant",
        {version:original.version,permissions:previous,data_scopes:previousScopes},output);
      return output;
    });
  }
  function parseProjectScopes(input: unknown, permissions: string[], previous: ProjectRoleScope[]): ProjectRoleScope[] {
    requireValue(Array.isArray(input), "操作数据范围必须是列表");
    const codes = new Set<string>();
    return input.map((value): ProjectRoleScope => {
      requireValue(isObject(value), "操作数据范围无效");
      const permission = scopedProjectPermissions.find(code => code === value.permission_code);
      requireValue(permission && permissions.includes(permission) && !codes.has(permission),
        "数据范围只能配置一次，且须对应本角色已授予的项目操作权限");
      codes.add(permission);
      const scope = value.scope;
      requireValue(scope === "all" || scope === "self" || scope === "department" ||
        scope === "department_and_children" || scope === "custom", "操作数据范围模式无效");
      const ids = value.organization_ids ?? [];
      requireValue(Array.isArray(ids) && ids.every((id): id is string => typeof id === "string"),
        "组织范围必须使用组织 ID 列表");
      const adopted = previous.find(row => row.permission_code === permission && row.scope === "custom");
      const added = ids.filter(id => !adopted?.organization_ids.includes(id));
      requireValue(scope === "custom" ? ids.length > 0 && new Set(ids).size === ids.length &&
        identity.validOrganizations(added) : ids.length === 0,
        "仅自定义范围可指定组织，组织必须有效且不可重复");
      return { permission_code: permission, scope, organization_ids: ids.toSorted() };
    }).filter(scope => scope.scope !== "all");
  }
  function permissions(actor: Actor) {
    authorize(actor, "role.manage");
    return repository.permissionCatalog();
  }
  return { entryBatch, actors, users, userRoleOptions, userDetail, saveUser, roles, role, saveRole, deleteRole, setRolePermissions, accessPolicy, setAccessPolicy, ips, saveIp, audits, searchAuditEvents, searchSecurityEvents, annotateAudit, permissions, menuRoutes };
}
export type ManagementService = ReturnType<typeof createManagement>;
