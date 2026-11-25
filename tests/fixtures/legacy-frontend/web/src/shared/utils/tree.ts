export interface TreeRecord {
  id: string;
  parent_id: string | null;
  name: string;
}
export type TreeNode<T extends TreeRecord> = T & {
  children: TreeNode<T>[];
  issue?: "orphan" | "cycle";
};
export function buildTree<T extends TreeRecord>(
  records: readonly T[],
): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const record of records) {
    if (nodes.has(record.id)) throw new Error("树节点身份重复");
    nodes.set(record.id, { ...record, children: [] });
  }
  const parents = new Map<string, string | null>();
  for (const node of nodes.values()) {
    const missing = node.parent_id && !nodes.has(node.parent_id);
    parents.set(node.id, missing ? null : node.parent_id);
    if (missing) node.issue = "orphan";
  }
  const done = new Set<string>();
  for (const id of nodes.keys()) {
    const positions = new Map<string, number>(),
      chain: string[] = [];
    let current: string | null = id;
    while (current && !done.has(current)) {
      const start = positions.get(current);
      if (start !== undefined) {
        for (const cyclic of chain.slice(start)) {
          parents.set(cyclic, null);
          nodes.get(cyclic)!.issue = "cycle";
        }
        break;
      }
      positions.set(current, chain.length);
      chain.push(current);
      current = parents.get(current) || null;
    }
    chain.forEach((key) => done.add(key));
  }
  const roots: TreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = parents.get(node.id);
    if (parent) nodes.get(parent)!.children.push(node);
    else roots.push(node);
  }
  const pending = [roots];
  while (pending.length) {
    const siblings = pending.pop()!;
    siblings.sort(
      (a, b) =>
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
    for (const node of siblings)
      if (node.children.length) pending.push(node.children);
  }
  return roots;
}
export function treePath<T extends TreeRecord>(
  records: readonly T[],
  id: string,
): T[] {
  const index = new Map(records.map((record) => [record.id, record]));
  const path: T[] = [],
    seen = new Set<string>();
  let node = index.get(id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.unshift(node);
    node = node.parent_id ? index.get(node.parent_id) : undefined;
  }
  return path;
}
export function descendantIds<T extends TreeRecord>(
  records: readonly T[],
  id: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const record of records)
    if (record.parent_id) {
      const ids = children.get(record.parent_id) || [];
      ids.push(record.id);
      children.set(record.parent_id, ids);
    }
  const found = new Set<string>(),
    pending = [...(children.get(id) || [])];
  while (pending.length) {
    const next = pending.pop()!;
    if (next === id || found.has(next)) continue;
    found.add(next);
    pending.push(...(children.get(next) || []));
  }
  return found;
}
export function matchingTreeIds<T extends TreeRecord>(
  records: readonly T[],
  query: string,
): Set<string> {
  const result = new Set<string>(),
    text = query.trim().toLocaleLowerCase("zh-CN");
  const index = new Map(records.map((record) => [record.id, record]));
  for (const record of records)
    if (!text || record.name.toLocaleLowerCase("zh-CN").includes(text)) {
      let current: T | undefined = record;
      while (current && !result.has(current.id)) {
        result.add(current.id);
        current = current.parent_id ? index.get(current.parent_id) : undefined;
      }
    }
  return result;
}
