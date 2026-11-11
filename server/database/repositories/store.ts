import type { Database } from "../connection.js";
import type { DatabaseSync } from "node:sqlite";

/**
 * Database-only SQLite statement/cache adapter. Application domains must use
 * dedicated repositories, not construct table or column identifiers.
 */
export type SqlRow = Record<string, unknown>;
type Statement = ReturnType<DatabaseSync["prepare"]>;
type SqlInput = string | number | bigint | Uint8Array | null;

function bind(value: unknown): SqlInput {
  if (value === null || typeof value === "string" || typeof value === "bigint" ||
    typeof value === "number" && Number.isFinite(value))
    return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw Error("SQLite参数须为有效标量或二进制值");
}

export function createStore(database: Database) {
  const db = database.connection;
  const tables = new Map<string, Set<string>>();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all();
  for (const item of names) {
    if (typeof item.name !== "string") throw Error("数据库对象名称格式无效");
    const fields = db.prepare(`PRAGMA table_xinfo("${item.name.replaceAll('"','""')}")`).all()
      .filter(field => field.hidden === 0)
      .map(field => field.name)
      .filter((name): name is string => typeof name === "string");
    tables.set(item.name,new Set(fields));
  }
  function table(name: string): string {
    if (!tables.has(name)) throw Error("未知数据库对象");
    return `"${name.replaceAll('"','""')}"`;
  }
  function columns<T extends object>(name: string, values: T): Array<[string, SqlInput]> {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    for (const [key] of entries)
      if (!tables.get(name)?.has(key)) throw Error(`未知字段 ${name}.${key}`);
    return entries.map(([key,value])=>[key,bind(value)]);
  }
  const cached = new Map<string, Statement>();
  const MAX_CACHED_STATEMENTS=256;
  function statement(sql:string):Statement {
    const old=cached.get(sql);
    if(old){
      cached.delete(sql);cached.set(sql,old);return old;
    }
    const compiled=db.prepare(sql);
    if(cached.size>=MAX_CACHED_STATEMENTS)
      cached.delete(cached.keys().next().value!);
    cached.set(sql,compiled);
    return compiled;
  }
  return {
    transaction<T>(action:()=>T):T {
      return database.transaction(action);
    },
    query<T extends object=SqlRow>(sql:string,...parameters:unknown[]):T[] {
      return statement(sql).all(...parameters.map(bind)) as unknown as T[];
    },
    get<T extends object=SqlRow>(sql:string,...parameters:unknown[]):T|undefined {
      return statement(sql).get(...parameters.map(bind)) as unknown as T|undefined;
    },
    run(sql:string,...parameters:unknown[]):ReturnType<Statement["run"]> {
      return statement(sql).run(...parameters.map(bind));
    },
    list<T extends object=SqlRow>(name:string):T[] {
      return statement(`SELECT * FROM ${table(name)}`).all() as unknown as T[];
    },
    where<T extends object=SqlRow>(name:string,values:Record<string,unknown>,
      orderBy?:string,limit?:number):T[] {
      const entries=columns(name,values);
      if(orderBy)columns(name,{[orderBy]:0});
      const predicates=entries.map(([key])=>`"${key}" IS ?`).join(" AND ");
      const order=orderBy?` ORDER BY "${orderBy}" DESC`:"";
      const bound=limit===1?" LIMIT 1":"";
      return statement(`SELECT * FROM ${table(name)}${predicates?" WHERE "+predicates:""}${order}${bound}`)
        .all(...entries.map(([,value])=>value)) as unknown as T[];
    },
    find<T extends object=SqlRow>(name:string,key:string,value:unknown):T|undefined {
      const [[column,arg]]=columns(name,{[key]:value});
      return statement(`SELECT * FROM ${table(name)} WHERE "${column}"=?`).get(arg) as unknown as T|undefined;
    },
    insert<T extends object>(name:string,values:T):T {
      const entries=columns(name,values);
      if(!entries.length)throw Error("SQL插入内容不能为空");
      const identifiers=entries.map(([key])=>`"${key}"`).join(",");
      const placeholders=entries.map(()=>"?").join(",");
      statement(`INSERT INTO ${table(name)} (${identifiers}) VALUES (${placeholders})`)
        .run(...entries.map(([,value])=>value));
      return values;
    },
    update<T extends object>(name:string,key:string,value:unknown,values:T):void {
      columns(name,{[key]:value});
      const entries=columns(name,values);
      if(!entries.length)throw Error("SQL更新内容不能为空");
      statement(`UPDATE ${table(name)} SET ${entries.map(([field])=>`"${field}"=?`).join(",")} WHERE "${key}"=?`)
        .run(...entries.map(([,value])=>value),bind(value));
    },
    remove(name:string,key:string,value:unknown):void {
      columns(name,{[key]:value});
      statement(`DELETE FROM ${table(name)} WHERE "${key}"=?`).run(bind(value));
    },
  };
}
export type Store = ReturnType<typeof createStore>;
