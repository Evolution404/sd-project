import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { isIP } from "node:net";
import { requireValue, text } from "../../shared/errors/business-error.js";
import type { Actor, Role } from "../../shared/types/contracts.js";
import type { IdentityRepository, UserChanges, UserRecord } from "../../database/repositories/identity.js";
import type { Database } from "../../database/connection.js";

export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const now = (): string => new Date().toISOString();
export const today = (): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export const id = (): string => randomUUID();

export function passwordHash(password: unknown): string {
  const value = text(password, "密码");
  requireValue(typeof password === "string" && password.length <= 256 && value.length > 0, "密码长度不能超过256位");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verify(password: string, encoded: string): boolean {
  const [salt, hash] = encoded.split(":");
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash || "", "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface SaveUserInput {
  username: string;
  password?: string;
  role?: Role;
  role_codes?: string[];
  display_name?: string;
  employee_no?: string | null;
  primary_org_id?: string | null;
  organization_ids?: string[];
  expected_version?: number;
  status?: string;
}
/**
 * Authentication reads grants only through persisted active role memberships.
 * The legacy user.role column is retained as a display/compatibility label,
 * and MUST NEVER grant an action by itself.
 */
export function createAuth(repository: IdentityRepository, boundary: Pick<Database, "transaction">) {
  function recordSecurityEvent(userId: string, event: string, ip?: string) {
    repository.recordSecurityEvent({ id:id(),user_id:userId,actor_id:userId,event,
      ip:ip||null,created_at:now() });
  }
  const sessionId = (tokenHash: string) => digest("own-session:" + tokenHash);
  function actor(token: string): Actor {
    const session = repository.session(digest(token || ""));
    const user = session && session.expires_at > now() ? repository.user(session.user_id) : undefined;
    requireValue(user && user.status === "active", "请登录", 401);
    const roles = repository.rolesForUser(user.id);
    requireValue(roles.length !== 0, "账号暂无有效角色", 403);
    const mustChangePassword = repository.mustChangePassword(user.id);
    return {
      id: user.id, username: user.username, role: user.role,
      roles, display_name: user.display_name || user.username,
      ...(mustChangePassword
        ? { password_change_required: true, permissions: [] }
        : { permissions: repository.permissionsForUser(user.id), project_access: repository.projectAccess(user.id) }),
    };
  }

  return {
    actor,
    permittedIp(address?: string): boolean {
      const ip = address?.replace(/^::ffff:/, "") || "";
      return !repository.ipRestrictionEnabled() ||
        ip === "127.0.0.1" || ip === "::1" || repository.allowed(ip);
    },
    login(username: unknown, password: unknown, address?: string) {
      requireValue(typeof username === "string" && username.length > 0 && username.length <= 128, "账号或密码错误", 401);
      requireValue(typeof password === "string" && password.length <= 256, "账号或密码错误", 401);
      const user = repository.userByName(username);
      const valid = verify(password, user?.password_hash || "00000000000000000000000000000000:" + "00".repeat(64));
      requireValue(valid && user?.status === "active", "账号或密码错误", 401);
      requireValue(repository.rolesForUser(user.id).length !== 0, "账号暂无有效角色", 403);
      const token = randomBytes(32).toString("hex");
      boundary.transaction(()=>{
        repository.addSession({ token_hash: digest(token), user_id: user.id, created_at: now(),
          expires_at: new Date(Date.now() + 8 * 3600000).toISOString() });
        recordSecurityEvent(user.id,"login",address);
      });
      return { token, user: actor(token) };
    },
    logout(token: string): void { repository.removeSession(digest(token || "")); },
    profile(current: Actor) {
      const user = repository.user(current.id);
      requireValue(user, "账号不存在", 404);
      const roleNames = (current.roles || []).map(code => repository.role(code)?.name ?? code);
      return { username:user.username, display_name:user.display_name, employee_no:user.employee_no,
        role_names:roleNames, created_at:user.created_at, permission_count:current.permissions.length };
    },
    sessions(current: Actor, token: string) {
      const activeToken = digest(token);
      return repository.activeSessions(current.id,now()).map(row=>({
        id:sessionId(row.token_hash), current:row.token_hash===activeToken,
        created_at:row.created_at,expires_at:row.expires_at,
      }));
    },
    revokeSession(current: Actor, token: string, key: string, address?: string) {
      requireValue(/^[a-f0-9]{64}$/.test(key), "未找到该登录会话", 404);
      return boundary.transaction(()=>{
        const target=repository.activeSessions(current.id,now()).find(row=>sessionId(row.token_hash)===key);
        requireValue(target,"未找到该登录会话",404);
        repository.removeSession(target.token_hash);
        recordSecurityEvent(current.id,"session_revoked",address);
        return { current:target.token_hash===digest(token) };
      });
    },
    changeOwnPassword(current: Actor, oldPassword: unknown, newPassword: unknown, address?: string) {
      requireValue(typeof oldPassword==="string"&&oldPassword.length<=256,"当前密码不正确",422);
      return boundary.transaction(()=>{
        const account=repository.userByName(current.username);
        requireValue(account?.id===current.id&&verify(oldPassword,account.password_hash),
          "当前密码不正确",422);
        if (current.password_change_required)
          requireValue(newPassword !== oldPassword, "新密码必须与临时密码不同", 422);
        repository.updatePassword(current.id,passwordHash(newPassword),now());
        repository.revoke(current.id);
        recordSecurityEvent(current.id,"password_changed",address);
        return { ok:true };
      });
    },
    initialize(username: string, password: string) {
      return boundary.transaction(() => {
        requireValue(repository.users().length === 0, "管理员已初始化", 409);
        const createdAt = now();
        const row: UserRecord = {
          id:id(),username:text(username,"账号"),display_name:username,employee_no:null,
          primary_org_id:null,role:"admin",status:"active",version:1,
          created_at:createdAt,updated_at:createdAt,
        };
        repository.addUser(row,passwordHash(password));
        repository.replaceRoles(row.id,["admin"],null,createdAt);
        return row;
      });
    },
    saveUser(user: Actor, input: SaveUserInput, userId?: string, temporaryPassword = false) {
      authorize(user, "user.manage");
      return boundary.transaction(() => {
        const current=userId?repository.user(userId):undefined;
        if(userId)requireValue(current,"用户不存在",404);
        const status=input.status || current?.status || "active";
        requireValue(["active","disabled"].includes(status),"账号状态无效");
        const primary:Role = input.role || current?.role || "viewer";
        requireValue(["admin","editor","verifier","viewer"].includes(primary),"无效主要角色");
        const selected = input.role_codes || (input.role ? [input.role] : userId ? repository.rolesForUser(userId) : [primary]);
        requireValue(Array.isArray(selected) && repository.validRoles(selected),"角色不存在、被禁用或重复");
        const originalRoles=userId?repository.rolesForUser(userId):[];
        const changingRoles=!userId
          ? selected.some(code=>code!=="viewer")
          : originalRoles.length!==selected.length||
            originalRoles.some(code=>!selected.includes(code));
        // Managing accounts alone never grants authority to assign privileged roles or
        // take control of an account with role-management privileges.
        const targetPrivileged=Boolean(userId &&
          repository.permissionsForUser(userId).includes("role.manage"));
        if(changingRoles || targetPrivileged || (userId && input.password))
          authorize(user,"role.manage");
        requireValue(input.expected_version===undefined||
          (Number.isSafeInteger(input.expected_version) && input.expected_version>=1),
          "用户版本号必须是正整数");
        const primaryOrg = input.primary_org_id===undefined
          ? current?.primary_org_id||null : input.primary_org_id||null;
        let orgIds = input.organization_ids === undefined
          ? userId ? repository.organizationsForUser(userId) : [] : input.organization_ids;
        requireValue(Array.isArray(orgIds)&&orgIds.every(v=>typeof v==="string"),"用户组织关联必须是组织ID列表");
        if(primaryOrg && input.organization_ids===undefined && !orgIds.includes(primaryOrg))
          orgIds=[...orgIds,primaryOrg];
        requireValue(!primaryOrg || orgIds.includes(primaryOrg),"主组织必须属于用户关联的组织");
        requireValue(repository.validOrganizations(orgIds),"组织不存在、非有效组织或关联重复");
        const name=text(input.username,"账号");
        const at=now();
        let result:UserRecord;
        if(!userId) {
          const row:UserRecord={
            id:id(),username:name,display_name:input.display_name?.trim() || name,
            employee_no:input.employee_no || null,primary_org_id:primaryOrg,
            role:primary,status,version:1,created_at:at,updated_at:at
          };
          result=repository.addUser(row,passwordHash(input.password),temporaryPassword);
          repository.replaceRoles(row.id,selected,user.id,at);
          repository.replaceOrganizations(row.id,orgIds,primaryOrg,at);
        } else {
          const values:UserChanges={username:name,role:primary,status,updated_at:at,
            primary_org_id:primaryOrg};
          if(input.display_name!==undefined)values.display_name=text(input.display_name,"姓名");
          if(input.employee_no!==undefined)values.employee_no=input.employee_no || null;
          if(input.primary_org_id!==undefined)values.primary_org_id=input.primary_org_id || null;
          requireValue(repository.updateUser(userId,values,input.expected_version),
            "用户版本已变化，请刷新后重试",409);
          if(input.password) repository.updatePassword(userId,passwordHash(input.password),at,temporaryPassword);
          repository.replaceRoles(userId,selected,user.id,at);
          repository.replaceOrganizations(userId,orgIds,primaryOrg,at);
          result=repository.user(userId)!;
          repository.revoke(userId);
        }
        requireValue(repository.hasAdministrator(),"必须保留一个有效管理员（具有系统管理授权）",409);
        return result;
      });
    },
    validateIp(value: string): string {
      requireValue(isIP(value) !== 0, "请输入完整IPv4或IPv6地址");
      return value;
    },
  };
}

export function authorize(actor: Actor | null | undefined, permission = "write"): void {
  requireValue(actor, "请登录", 401);
  requireValue(actor.permissions.includes(permission),
    permission === "write" ? "需要编辑权限"
      : permission === "admin" ? "需要管理员权限" : "无此操作权限",403);
}
