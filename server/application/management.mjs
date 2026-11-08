import { authorize, id, now } from "./auth.mjs";
import { requireValue } from "../domain/errors.mjs";

/** System-admin application boundary; HTTP must not reach repositories. */
export function createManagement({ repo, identity, auth, catalog }) {
  function actors(actor) {
    authorize(actor, "read");
    const deleted = repo.deleted("users");
    return identity.users()
      .filter((user) => user.status === "active" && !deleted.has(user.id))
      .map(({ id, username }) => ({ id, username }));
  }
  function users(actor, includeDeleted = false) {
    authorize(actor, "admin");
    const deleted = repo.deleted("users");
    return identity.users()
      .filter((user) => includeDeleted || !deleted.has(user.id))
      .map((user) => ({ ...user, deleted: deleted.has(user.id) }));
  }
  function saveUser(actor, input, key, method) {
    authorize(actor, "admin");
    requireValue(!key || !repo.deleted("users").has(key), "用户已删除", 409);
    const current = key ? identity.users().find((user) => user.id === key) : null;
    if (key) requireValue(current, "用户不存在", 404);
    if (method === "DELETE") requireValue(key, "未指定要删除的用户", 422);
    const output = method === "DELETE"
      ? auth.saveUser(actor, { ...current, status: "disabled" }, key)
      : auth.saveUser(actor, input, key);
    catalog.audit(
      actor, "users", key || output.id,
      method === "DELETE" ? "delete" : key ? "revise" : "create",
      current, method === "DELETE" ? { logical: true } : output,
    );
    return output;
  }
  function ips(actor) {
    authorize(actor, "admin");
    return repo.list("allowed_ips");
  }
  function saveIp(actor, input, key, method) {
    authorize(actor, "admin");
    const original = key ? repo.find("allowed_ips", "id", key) : null;
    if (key) requireValue(original, "IP授权不存在", 404);
    if (method === "DELETE") {
      requireValue(original, "IP授权不存在", 404);
      catalog.audit(actor, "ips", key, "delete", original, { deleted: true });
      repo.remove("allowed_ips", "id", key);
      return { deleted: true };
    }
    const values = { ip: auth.validateIp(input.ip), note: input.note || "" };
    const configId = key || id();
    if (key) repo.update("allowed_ips", "id", key, values);
    else repo.insert("allowed_ips", {
      id: configId, ...values, created_by: actor.id, created_at: now(),
    });
    catalog.audit(actor, "ips", configId, key ? "revise" : "create", original, values);
    return { ok: true };
  }
  function audits(actor, includeDeleted = false, key) {
    authorize(actor, "admin");
    if (key) {
      const original = repo.find("audit_events", "id", key);
      requireValue(original, "审计记录不存在", 404);
      return { original, decisions: repo.auditFor("audit", key) };
    }
    const hidden = repo.deleted("audit");
    return repo.list("audit_events")
      .filter((event) => includeDeleted || !hidden.has(event.id));
  }
  function annotateAudit(actor, input, key, method) {
    authorize(actor, "admin");
    if (key) {
      requireValue(repo.find("audit_events", "id", key), "审计记录不存在", 404);
      catalog.audit(actor, "audit", key,
        method === "DELETE" ? "delete" : "correct", null,
        method === "DELETE" ? { logical: true } : { message: input.message || "" },
      );
    } else {
      requireValue(method !== "DELETE", "未指定审计记录", 422);
      catalog.audit(actor, "manual", id(), "note", null, { message: input.message || "" });
    }
    return { ok: true };
  }
  function permissions(actor) {
    authorize(actor, "admin");
    return {
      definitions: repo.list("permission_definitions"),
      grants: repo.list("role_permissions"),
    };
  }
  return { actors, users, saveUser, ips, saveIp, audits, annotateAudit, permissions };
}
