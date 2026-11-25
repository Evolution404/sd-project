import type { Actor, Role } from "../../shared/types/contracts.js";
import type { ProjectAccess, ProjectRoleScope } from "../../shared/types/project-access.js";
import type { createStore } from "./store.js";

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  employee_no: string | null;
  primary_org_id: string | null;
  role: Role; // Y2 transition only: legacy primary role label, NOT authorization
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export type PublicUser = UserRecord;
export type UserChanges = Partial<Pick<UserRecord,
  "username" | "display_name" | "employee_no" | "primary_org_id" | "role" | "status" | "updated_at">>;
export interface SessionRecord {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}
export interface RoleRecord {
  code: string;
  name: string;
  status: string;
  version: number;
  sort_order: number;
  system_seed: number;
  auto_grant_new_permissions: number;
  created_at: string;
  updated_at: string;
}
interface RequestReceipt {
  request_key: string;
  actor_id: string;
  request_hash: string;
  result_json: string;
  created_at: string;
}

export function identityRepository(store: ReturnType<typeof createStore>) {
  function membership(userId: string): string[] {
    return store.query<{ role_code: string }>(`
      SELECT ur.role_code FROM user_roles ur JOIN roles r ON r.code=ur.role_code
      WHERE ur.user_id=? AND r.status='active' ORDER BY r.sort_order,r.code`, userId
    ).map(row => row.role_code);
  }
  function permissionsFor(userId: string): string[] {
    const rows = store.query<{ permission_code: string }>(`
      SELECT DISTINCT rp.permission_code FROM role_permissions rp
      JOIN user_roles ur ON ur.role_code=rp.role
      JOIN roles r ON r.code=ur.role_code
      WHERE ur.user_id=? AND r.status='active'
      ORDER BY CASE rp.permission_code WHEN 'read' THEN 0 WHEN 'write' THEN 1
        WHEN 'admin' THEN 2 ELSE 3 END, rp.permission_code`, userId);
    return rows.map(row => row.permission_code);
  }
  return {
    userByName(name: string): (UserRecord & { password_hash: string }) | undefined {
      return store.get<UserRecord & { password_hash: string }>(
        "SELECT u.*,c.password_hash FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.username=?", name);
    },
    user: (userId: string) => store.find<UserRecord>("users","id",userId),
    mustChangePassword: (userId: string) => store.get<{ require_change: number }>(
      "SELECT require_change FROM user_credentials WHERE user_id=?", userId,
    )?.require_change === 1,
    actorNames(ids: string[]): Map<string, string> {
      if (!ids.length) return new Map();
      return new Map(store.query<{ id: string; username: string }>(
        "SELECT id,username FROM users WHERE id IN (SELECT value FROM json_each(?))",
        JSON.stringify(ids),
      ).map(user => [user.id, user.username]));
    },
    users: (): PublicUser[] => store.list<UserRecord>("users"),
    addUser(row: UserRecord, password_hash: string, requireChange = false): UserRecord {
      store.insert("users",row);
      store.insert("user_credentials",{
        user_id:row.id,password_hash,algorithm:"scrypt-v1",
        changed_at:row.created_at,require_change:Number(requireChange)
      });
      return row;
    },
    updateUser(userId:string,values:UserChanges,expectedVersion?:number):boolean {
      const previous=store.get<{version:number}>("SELECT version FROM users WHERE id=?",userId);
      if(!previous || (expectedVersion!==undefined&&previous.version!==expectedVersion))return false;
      store.update("users","id",userId,{...values,version:previous.version+1});
      return true;
    },
    updatePassword(userId:string,password_hash:string,changed_at:string,requireChange=false):void {
      store.update("user_credentials","user_id",userId,{
        password_hash,changed_at,require_change:Number(requireChange)
      });
    },
    session: (hash: string) => store.find<SessionRecord>("sessions", "token_hash", hash),
    activeSessions(userId: string, at: string): SessionRecord[] {
      return store.query<SessionRecord>(
        "SELECT * FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC", userId, at);
    },
    recordSecurityEvent(event: {
      id:string; user_id:string; actor_id:string; event:string; ip:string|null; created_at:string;
    }) {
      store.insert("security_events", event);
    },
    addSession: (row: SessionRecord) => store.insert("sessions", row),
    removeSession: (hash: string) => store.remove("sessions", "token_hash", hash),
    revoke: (userId: string) => store.run("DELETE FROM sessions WHERE user_id=?", userId),
    revokeRoleMembers(code:string):void {
      store.run("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_code=?)",code);
    },
    ipRestrictionEnabled():boolean {
      return store.get<{ip_restriction_enabled:number}>(
        "SELECT ip_restriction_enabled FROM access_policy WHERE id=1"
      )?.ip_restriction_enabled !== 0;
    },
    allowed: (ip: string) => Boolean(store.find("allowed_ips", "ip", ip)),
    roles: ():RoleRecord[] => store.query<RoleRecord>("SELECT * FROM roles ORDER BY sort_order,code"),
    role:(code:string):RoleRecord|undefined=>store.find<RoleRecord>("roles","code",code),
    rolesForUser: membership,
    organizationsForUser(userId:string):string[] {
      return store.query<{organization_id:string}>(
        "SELECT organization_id FROM user_organizations WHERE user_id=? ORDER BY is_primary DESC,organization_id",
        userId).map(row=>row.organization_id);
    },
    validOrganizations(ids:string[]):boolean {
      if(new Set(ids).size!==ids.length)return false;
      return ids.every(orgId=>Boolean(store.get(
        "SELECT id FROM v_organizational_unit_current WHERE id=? AND status='active'",orgId)));
    },
    replaceOrganizations(userId:string,ids:string[],primary:string|null,at:string):void {
      store.run("DELETE FROM user_organizations WHERE user_id=?",userId);
      for(const organizationId of ids)store.insert("user_organizations",{
        user_id:userId,organization_id:organizationId,
        is_primary:Number(primary===organizationId),assigned_at:at,
      });
    },
    permissionsForUser: permissionsFor,
    projectAccess(userId: string): Record<string, ProjectAccess> {
      // Expand membership only for configured permissions. A grant without a
      // restrictive configuration is global for that permission alone.
      const grants = store.query<Omit<ProjectRoleScope, "organization_ids"> & { organization_ids_json: string }>(`
        SELECT DISTINCT rp.permission_code, COALESCE(s.scope,'all') AS scope,
          COALESCE(s.organization_ids_json,'[]') AS organization_ids_json
        FROM user_roles ur JOIN roles r ON r.code=ur.role_code AND r.status='active'
        JOIN role_permissions rp ON rp.role=r.code
        LEFT JOIN role_data_scopes s ON s.role_code=r.code AND s.permission_code=rp.permission_code
        WHERE ur.user_id=? AND EXISTS(
          SELECT 1 FROM user_roles assignment
          JOIN roles assigned ON assigned.code=assignment.role_code AND assigned.status='active'
          JOIN role_data_scopes restriction ON restriction.role_code=assigned.code
          WHERE assignment.user_id=ur.user_id AND restriction.permission_code=rp.permission_code
            AND restriction.scope<>'all'
        )
        ORDER BY rp.permission_code, scope, organization_ids_json`, userId);
      const global = new Set(grants.filter(grant => grant.scope === "all").map(grant => grant.permission_code));
      const restricted = grants.filter(grant => !global.has(grant.permission_code));
      if (!restricted.length) return {};
      const members = restricted.some(grant => grant.scope === "department" || grant.scope === "department_and_children")
        ? store.query<{id: string}>(`SELECT o.id FROM user_organizations m
          JOIN v_organizational_unit_current o ON o.id=m.organization_id AND o.status='active'
          WHERE m.user_id=?`, userId).map(row => row.id) : [];
      const descendants = restricted.some(grant => grant.scope === "department_and_children")
        ? store.query<{id: string}>(`WITH RECURSIVE permitted(id) AS (
            SELECT value FROM json_each(?)
            UNION
            SELECT child.id FROM v_organizational_unit_current child
            JOIN permitted parent ON child.parent_unit_id=parent.id WHERE child.status='active'
          ) SELECT id FROM permitted`, JSON.stringify(members)).map(row => row.id) : [];
      const access = new Map<string, { owner_id: string | null; organizations: Set<string> }>();
      for (const grant of restricted) {
        const entry = access.get(grant.permission_code) ?? { owner_id: null, organizations: new Set<string>() };
        if (grant.scope === "self") entry.owner_id = userId;
        const organizations = grant.scope === "custom" ? JSON.parse(grant.organization_ids_json) as string[]
          : grant.scope === "department_and_children" ? descendants
          : grant.scope === "department" ? members : [];
        for (const orgId of organizations) entry.organizations.add(orgId);
        access.set(grant.permission_code, entry);
      }
      return Object.fromEntries([...access].map(([permission, {owner_id, organizations}]) =>
        [permission, { owner_id, organization_ids: [...organizations].sort() }]));
    },
    validRoles(codes:string[]):boolean {
      if(!codes.length || new Set(codes).size!==codes.length)return false;
      return codes.every(code=>this.role(code)?.status==="active");
    },
    replaceRoles(userId:string,codes:string[],actorId:string|null,changedAt:string):void {
      store.run("DELETE FROM user_roles WHERE user_id=?",userId);
      for(const code of codes)store.insert("user_roles",{
        user_id:userId,role_code:code,assigned_at:changedAt,assigned_by:actorId
      });
    },
    hasAdministrator():boolean {
      // Safeguard recovery, not permanent ROOT permission: the same enabled
      // account must have BOTH user and role management via any active roles.
      // The legacy 'admin' privilege alone is insufficient to restore grants.
      const row=store.get<{n:number}>(`
        SELECT COUNT(*) AS n FROM users u JOIN user_credentials c ON c.user_id=u.id
        WHERE u.status='active' AND c.require_change=0 AND (
          SELECT COUNT(DISTINCT rp.permission_code)
          FROM user_roles ur
          JOIN roles r ON r.code=ur.role_code AND r.status='active'
          JOIN role_permissions rp ON rp.role=r.code
          WHERE ur.user_id=u.id
            AND rp.permission_code IN ('user.manage','role.manage')
        )=2`);
      return Boolean(row?.n);
    },
    permissionsForRole(code:string):string[] {
      return store.query<{permission_code:string}>(
        "SELECT permission_code FROM role_permissions WHERE role=? ORDER BY permission_code",code
      ).map(row=>row.permission_code);
    },
    scopesForRole(code: string): ProjectRoleScope[] {
      return store.query<Omit<ProjectRoleScope, "organization_ids"> & { organization_ids_json: string }>(
        "SELECT permission_code,scope,organization_ids_json FROM role_data_scopes WHERE role_code=? ORDER BY permission_code", code,
      ).map(({organization_ids_json, ...row}) => ({
        ...row,
        organization_ids: JSON.parse(organization_ids_json) as string[],
      }));
    },
    replaceRoleScopes(code: string, scopes: ProjectRoleScope[]): void {
      store.run("DELETE FROM role_data_scopes WHERE role_code=?", code);
      for (const {permission_code, scope, organization_ids} of scopes) {
        store.insert("role_data_scopes", {
          role_code: code, permission_code, scope, organization_ids_json: JSON.stringify(organization_ids),
        });
      }
    },
    allPermissions():string[] {
      return store.query<{code:string}>("SELECT code FROM permission_definitions ORDER BY code").map(x=>x.code);
    },
    createRole(row:RoleRecord):void {store.insert("roles",row);},
    roleMemberCount(code:string):number {
      return store.get<{n:number}>("SELECT count(*) AS n FROM user_roles WHERE role_code=?",code)?.n||0;
    },
    deleteRole(code:string):void {
      store.run("DELETE FROM role_permissions WHERE role=?",code);
      store.run("DELETE FROM role_data_scopes WHERE role_code=?",code);
      store.run("DELETE FROM roles WHERE code=?",code);
    },
    updateRole(code:string,values:Partial<RoleRecord>):void {
      store.update("roles","code",code,values);
    },
    setRolePermissions(code:string,codes:string[]):void {
      store.run("DELETE FROM role_permissions WHERE role=?",code);
      for(const permission_code of codes)
        store.insert("role_permissions",{role:code,permission_code});
    },
    requestReceipt: (key: string) => store.find("ledger_requests", "request_key", key) as RequestReceipt | undefined,
    recordRequest(actor: Actor, key: string, hash: string, result: unknown, createdAt: string): void {
      store.insert("ledger_requests", {
        request_key: key, actor_id: actor.id, request_hash: hash,
        result_json: JSON.stringify(result), created_at: createdAt,
      });
    },
  };
}
export type IdentityRepository = ReturnType<typeof identityRepository>;
