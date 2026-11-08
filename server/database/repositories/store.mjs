// SQL identifiers are restricted to schema inventory and server-owned names.
export function createStore(database) {
  const db = database.connection;
  const tables = new Map(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all()
    .map(({ name }) => [name, new Set(db.prepare(`PRAGMA table_xinfo("${name}")`).all().filter(c => c.hidden === 0).map(c => c.name))]));
  function table(name) {
    if (!tables.has(name)) throw Error('未知数据库对象');
    return `"${name}"`;
  }
  function columns(name, values) {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    for (const [key] of entries) if (!tables.get(name)?.has(key)) throw Error(`未知字段 ${name}.${key}`);
    return entries;
  }
  return {
    transaction: action => database.transaction(action),
    query(sql, ...parameters) { return db.prepare(sql).all(...parameters); },
    get(sql, ...parameters) { return db.prepare(sql).get(...parameters); },
    run(sql, ...parameters) { return db.prepare(sql).run(...parameters); },
    list(name) { return db.prepare(`SELECT * FROM ${table(name)}`).all(); },
    where(name, values, orderBy, limit) {
      const entries = columns(name, values);
      if (orderBy) columns(name, { [orderBy]: 0 });
      const predicates = entries.map(([key]) => `"${key}" IS ?`).join(' AND ');
      const order = orderBy ? ` ORDER BY "${orderBy}" DESC` : '';
      const bound = limit === 1 ? ' LIMIT 1' : '';
      return db.prepare(`SELECT * FROM ${table(name)}${predicates ? ' WHERE ' + predicates : ''}${order}${bound}`).all(...entries.map(([, value]) => value));
    },
    find(name, key, value) {
      columns(name, { [key]: value });
      return db.prepare(`SELECT * FROM ${table(name)} WHERE "${key}"=?`).get(value);
    },
    insert(name, values) {
      const entries = columns(name, values);
      db.prepare(`INSERT INTO ${table(name)} (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map(() => '?').join(',')})`).run(...entries.map(([, value]) => value));
      return values;
    },
    update(name, key, value, values) {
      columns(name, { [key]: value });
      const entries = columns(name, values);
      return db.prepare(`UPDATE ${table(name)} SET ${entries.map(([key]) => `"${key}"=?`).join(',')} WHERE "${key}"=?`).run(...entries.map(([, value]) => value), value);
    },
    remove(name, key, value) {
      columns(name, { [key]: value });
      return db.prepare(`DELETE FROM ${table(name)} WHERE "${key}"=?`).run(value);
    }
  };
}
