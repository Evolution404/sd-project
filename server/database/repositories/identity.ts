import type { Actor, Role } from "../../shared/types/contracts.js";
import type { createStore } from "./store.js";

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  status: string;
  created_at: string;
}
export type PublicUser = Omit<UserRecord, "password_hash">;
export interface UserChanges {
  username: string;
  role: Role;
  status: string;
  password_hash?: string;
}
export interface SessionRecord {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}
interface RequestReceipt {
  request_key: string;
  actor_id: string;
  request_hash: string;
  result_json: string;
  created_at: string;
}

export function identityRepository(store: ReturnType<typeof createStore>) {
  return {
    userByName: (name: string) => store.find("users", "username", name) as UserRecord | undefined,
    user: (id: string) => store.find("users", "id", id) as UserRecord | undefined,
    users: (): PublicUser[] => (store.list("users") as UserRecord[]).map(({ password_hash: _password, ...user }) => user),
    addUser(row: UserRecord): UserRecord { store.insert("users", row); return row; },
    updateUser: (id: string, values: UserChanges) => store.update("users", "id", id, values),
    session: (hash: string) => store.find("sessions", "token_hash", hash) as SessionRecord | undefined,
    addSession: (row: SessionRecord) => store.insert("sessions", row),
    removeSession: (hash: string) => store.remove("sessions", "token_hash", hash),
    revoke: (id: string) => store.run("DELETE FROM sessions WHERE user_id=?", id),
    allowed: (ip: string) => Boolean(store.find("allowed_ips", "ip", ip)),
    permissions: (role: Role): string[] => store.query<{ permission_code: string }>(
      "SELECT permission_code FROM role_permissions WHERE role=?", role,
    ).map(row => row.permission_code),
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
