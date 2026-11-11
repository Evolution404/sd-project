import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { isIP } from "node:net";
import { requireValue, text } from "../../shared/errors/business-error.js";
import type { Actor, Role } from "../../shared/types/contracts.js";
import type { IdentityRepository, UserChanges } from "../../database/repositories/identity.js";
import type { Database } from "../../database/connection.js";

export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const now = (): string => new Date().toISOString();
export const today = (): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export const id = (): string => randomUUID();
export const documentCode = (prefix: string, identity = id()): string =>
  `${prefix}-${today().replaceAll("-", "")}-${identity.replaceAll("-", "").toUpperCase()}`;

export function passwordHash(password: unknown): string {
  const value = text(password, "密码");
  // Preserve password whitespace as part of the credential.
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
  role: Role;
  status?: string;
}
export function createAuth(repository: IdentityRepository, boundary: Pick<Database, "transaction">) {
  function actor(token: string): Actor {
    const session = repository.session(digest(token || ""));
    const user = session && session.expires_at > now() ? repository.user(session.user_id) : undefined;
    requireValue(user && user.status === "active", "请登录", 401);
    return {
      id: user.id, username: user.username, role: user.role,
      permissions: ["read", ...(["admin", "editor"].includes(user.role) ? ["write"] : []),
        ...(user.role === "admin" ? ["admin"] : []), ...repository.permissions(user.role)],
    };
  }
  return {
    actor,
    permittedIp(address?: string): boolean {
      const ip = address?.replace(/^::ffff:/, "") || "";
      return !repository.ipRestrictionEnabled() ||
        ip === "127.0.0.1" || ip === "::1" || repository.allowed(ip);
    },
    login(username: unknown, password: unknown) {
      requireValue(typeof username === "string" && username.length > 0 && username.length <= 128, "账号或密码错误", 401);
      requireValue(typeof password === "string" && password.length <= 256, "账号或密码错误", 401);
      const user = repository.userByName(username);
      const valid = verify(password, user?.password_hash || "00000000000000000000000000000000:" + "00".repeat(64));
      requireValue(valid && user?.status === "active", "账号或密码错误", 401);
      const token = randomBytes(32).toString("hex");
      repository.addSession({ token_hash: digest(token), user_id: user.id, created_at: now(),
        expires_at: new Date(Date.now() + 8 * 3600000).toISOString() });
      return { token, user: actor(token) };
    },
    logout(token: string): void { repository.removeSession(digest(token || "")); },
    initialize(username: string, password: string) {
      return boundary.transaction(() => {
        requireValue(repository.users().length === 0, "管理员已初始化", 409);
        return repository.addUser({ id: id(), username: text(username, "账号"),
          password_hash: passwordHash(password), role: "admin", status: "active", created_at: now() });
      });
    },
    saveUser(user: Actor, input: SaveUserInput, userId?: string) {
      authorize(user, "admin");
      requireValue(["admin", "editor", "verifier", "viewer"].includes(input.role), "无效角色");
      return boundary.transaction(() => {
        const values: UserChanges = { username: text(input.username, "账号"), role: input.role, status: input.status || "active" };
        if (input.password) values.password_hash = passwordHash(input.password);
        if (!userId) {
          const { password_hash: _password, ...publicUser } = repository.addUser({ id: id(), ...values,
            password_hash: passwordHash(input.password), created_at: now() });
          return publicUser;
        }
        const old = repository.user(userId);
        requireValue(old, "用户不存在", 404);
        if (old.role === "admin" && old.status === "active" && (values.role !== "admin" || values.status !== "active"))
          requireValue(repository.users().filter(item => item.role === "admin" && item.status === "active").length > 1,
            "必须保留一个有效管理员");
        repository.updateUser(userId, values);
        repository.revoke(userId);
        return repository.users().find(item => item.id === userId);
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
  if (permission === "read") return;
  if (permission === "write") requireValue(["admin", "editor"].includes(actor.role), "需要编辑权限", 403);
  else if (permission === "admin") requireValue(actor.role === "admin", "需要管理员权限", 403);
  else requireValue(actor.permissions.includes(permission), "无此操作权限", 403);
}
