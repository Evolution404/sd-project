export function parseTowerList(text: string): string[] {
  const numbers: string[] = [];
  for (const token of text.split(/[\s,，、;；]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (!range) {
      numbers.push(token);
      continue;
    }
    const start = Number(range[1]),
      end = Number(range[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      end < start ||
      end - start >= 5000
    )
      throw Error("杆号区间须按升序且最多5000个候选");
    const width = range[1].startsWith("0") ? range[1].length : 0;
    for (let value = start; value <= end; value++)
      numbers.push(String(value).padStart(width, "0"));
  }
  if (numbers.length > 5000) throw Error("单次杆号清单最多5000项");
  return numbers;
}
