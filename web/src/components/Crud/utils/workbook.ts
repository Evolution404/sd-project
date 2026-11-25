/**
 * 导入接口返回的有效行、无效行及错误摘要
 */
interface ImportSummary {
  validCount: number;
  invalidCount: number;
  messages: string[];
}

/**
 * 识别项目的 ExcelResult；无返回值的导入接口不需要适配
 */
export function readImportSummary(result: unknown): ImportSummary | undefined {
  if (!result || typeof result !== "object") return undefined;
  const validCount: unknown = Reflect.get(result, "validCount");
  const invalidCount: unknown = Reflect.get(result, "invalidCount");
  const messages: unknown = Reflect.get(result, "messageList");
  if (!Object.hasOwn(result, "validCount") && !Object.hasOwn(result, "invalidCount"))
    return undefined;
  if (
    typeof validCount !== "number" ||
    typeof invalidCount !== "number" ||
    !Number.isSafeInteger(validCount) ||
    !Number.isSafeInteger(invalidCount) ||
    validCount < 0 ||
    invalidCount < 0
  )
    throw new Error("导入接口返回的统计格式不正确");
  return {
    validCount,
    invalidCount,
    messages: Array.isArray(messages)
      ? messages.filter((value: unknown): value is string => typeof value === "string")
      : [],
  };
}
