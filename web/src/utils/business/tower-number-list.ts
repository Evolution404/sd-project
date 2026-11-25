const MAX_ITEMS = 5000;

/**
 * An ascending integer interval includes its endpoints and all actual inserted
 * towers strictly before the upper endpoint. Both N+suffix and N-suffix follow
 * tower N; neither denotes arithmetic addition/subtraction.
 * Single numbers and non-range labels retain exact identity matching.
 */
export function parseTowerList(text: string, existingNumbers: Iterable<string> = []): string[] {
  const inserted = new Map<number, string[]>();
  for (const label of new Set(existingNumbers)) {
    const part = /^(\d+)[+-]\d+$/.exec(label);
    if (!part) continue;
    const base = Number(part[1]);
    if (!Number.isSafeInteger(base)) continue;
    const group = inserted.get(base) ?? [];
    group.push(label);
    inserted.set(base, group);
  }
  for (const group of inserted.values())
    group.sort((a, b) => a.localeCompare(b, "en", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0));

  const numbers: string[] = [];
  const append = (label: string) => {
    if (numbers.length >= MAX_ITEMS) throw Error("单次杆号清单最多5000项（含插入塔）");
    numbers.push(label);
  };
  for (const token of text.split(/[\s,，、;；]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (!range) {
      append(token);
      continue;
    }
    const start = Number(range[1]), end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      throw Error("杆号区间超出有效整数范围");
    // A descending numeric label (e.g. 1786-1) is a literal inserted tower.
    if (end < start) {
      append(token);
      continue;
    }
    if (end - start >= MAX_ITEMS)
      throw Error("杆号区间最多5000个候选");
    const width = range[1].startsWith("0") ? range[1].length : 0;
    for (let value = start; ; value++) {
      append(String(value).padStart(width, "0"));
      if (value === end) break;
      for (const label of inserted.get(value) ?? []) append(label);
    }
  }
  return numbers;
}
