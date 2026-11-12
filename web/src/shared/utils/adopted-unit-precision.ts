export interface UnitVersionPrecision {
  version: number;
  quantity_precision?: number | null;
}
export function requireAdoptedQuantityPrecision(
  versions: UnitVersionPrecision[],
  version: number,
): number {
  if (!Number.isSafeInteger(version) || version < 1)
    throw Error("采用的计量单位正式版本无效");
  const adopted = versions.find(item => item.version === version);
  if (!adopted) throw Error("采用的计量单位正式版本不存在，不能录入数量");
  const precision = adopted.quantity_precision;
  if (typeof precision !== "number" || !Number.isInteger(precision) ||
      precision < 0 || precision > 4)
    throw Error("采用的计量单位正式版本缺少有效数量精度");
  return precision;
}
