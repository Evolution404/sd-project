// SQL identifiers are restricted to schema inventory and server-owned names.
export function createStore(database) {
  const db = database.connection;
  const tables = new Map(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map(({ name }) => [
        name,
        new Set(
          db
            .prepare(`PRAGMA table_xinfo("${name}")`)
            .all()
            .filter((c) => c.hidden === 0)
            .map((c) => c.name),
        ),
      ]),
  );
  function table(name) {
    if (!tables.has(name)) throw Error("未知数据库对象");
    return `"${name}"`;
  }
  function columns(name, values) {
    const entries = Object.entries(values).filter(
      ([, value]) => value !== undefined,
    );
    for (const [key] of entries)
      if (!tables.get(name)?.has(key)) throw Error(`未知字段 ${name}.${key}`);
    return entries;
  }
  // SQLite statements are compiled once for recurrent business reads/writes.
  // Keep a bounded LRU so dynamic WHERE/INSERT shapes cannot grow unbounded.
  const statements = new Map();
  const MAX_CACHED_STATEMENTS = 256;
  function statement(sql) {
    let compiled = statements.get(sql);
    if (compiled) {
      statements.delete(sql);
      statements.set(sql, compiled);
      return compiled;
    }
    compiled = db.prepare(sql);
    if (statements.size >= MAX_CACHED_STATEMENTS)
      statements.delete(statements.keys().next().value);
    statements.set(sql, compiled);
    return compiled;
  }
  return {
    transaction: (action) => database.transaction(action),
    query(sql, ...parameters) {
      return statement(sql).all(...parameters);
    },
    get(sql, ...parameters) {
      return statement(sql).get(...parameters);
    },
    run(sql, ...parameters) {
      return statement(sql).run(...parameters);
    },
    list(name) {
      return statement(`SELECT * FROM ${table(name)}`).all();
    },
    where(name, values, orderBy, limit) {
      const entries = columns(name, values);
      if (orderBy) columns(name, { [orderBy]: 0 });
      const predicates = entries.map(([key]) => `"${key}" IS ?`).join(" AND ");
      const order = orderBy ? ` ORDER BY "${orderBy}" DESC` : "";
      const bound = limit === 1 ? " LIMIT 1" : "";
      return statement(
          `SELECT * FROM ${table(name)}${predicates ? " WHERE " + predicates : ""}${order}${bound}`,
        )
        .all(...entries.map(([, value]) => value));
    },
    find(name, key, value) {
      columns(name, { [key]: value });
      return statement(`SELECT * FROM ${table(name)} WHERE "${key}"=?`)
        .get(value);
    },
    insert(name, values) {
      const entries = columns(name, values);
      statement(
        `INSERT INTO ${table(name)} (${entries.map(([key]) => `"${key}"`).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
      ).run(...entries.map(([, value]) => value));
      return values;
    },
    update(name, key, value, values) {
      columns(name, { [key]: value });
      const entries = columns(name, values);
      return statement(
          `UPDATE ${table(name)} SET ${entries.map(([key]) => `"${key}"=?`).join(",")} WHERE "${key}"=?`,
        )
        .run(...entries.map(([, value]) => value), value);
    },
    remove(name, key, value) {
      columns(name, { [key]: value });
      return statement(`DELETE FROM ${table(name)} WHERE "${key}"=?`)
        .run(value);
    },
  };
}
