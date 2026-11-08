export function identityRepository(store) {
  return {
    userByName: (name) => store.find("users", "username", name),
    user: (id) => store.find("users", "id", id),
    users: () => store.list("users").map(({ password_hash, ...user }) => user),
    addUser: (row) => store.insert("users", row),
    updateUser: (id, values) => store.update("users", "id", id, values),
    session: (hash) => store.find("sessions", "token_hash", hash),
    addSession: (row) => store.insert("sessions", row),
    removeSession: (hash) => store.remove("sessions", "token_hash", hash),
    revoke: (id) => store.run("DELETE FROM sessions WHERE user_id=?", id),
    allowed: (ip) => Boolean(store.find("allowed_ips", "ip", ip)),
    permissions: (role) =>
      store
        .query(
          "SELECT permission_code FROM role_permissions WHERE role=?",
          role,
        )
        .map((x) => x.permission_code),
  };
}
