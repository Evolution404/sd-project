import { newClientId } from "./id";

export type Row = Record<string, any>;
export class ApiError extends Error {
  fields: Row;
  constructor(message: string, fields: Row = {}) {
    super(message);
    this.fields = fields;
  }
}
export async function api<T = Row>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "Idempotency-Key": newClientId() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.message || "请求失败", result.fields);
  return result;
}
export async function download(path: string, filename: string) {
  const response = await fetch("/api" + path, { credentials: "same-origin" });
  if (!response.ok) throw new Error((await response.json()).message);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function displayFixed(value: number, places: number, trim = false) {
  const integer = BigInt(value),
    negative = integer < 0n,
    absolute = negative ? -integer : integer,
    factor = 10n ** BigInt(places);
  let decimal = (absolute % factor).toString().padStart(places, "0");
  if (trim) decimal = decimal.replace(/0+$/, "");
  return (
    (negative ? "-" : "") +
    (absolute / factor).toLocaleString("zh-CN") +
    (decimal ? "." + decimal : "")
  );
}
export const money = (value: number | null | undefined) =>
  value == null ? "未核定" : displayFixed(value, 2);
export const quantity = (value: number | undefined) =>
  displayFixed(value || 0, 4, true);
export const statusText: Row = {
  outage: "停电",
  non_outage: "不停电",
  unspecified: "未明确",
  both: "不限作业方式",
  withdrawn: "已撤回",
  active: "有效",
  pending: "待确认",
  returned: "已退回",
  cancelled: "已取消",
  inactive: "停用",
  retired: "退役",
  draft: "草稿",
  reserve: "储备",
  stocked: "已入库",
  approved: "已批准",
  closed: "已结项",
  approve: "已审核",
  submit: "待审核",
  return: "退回",
  reject: "驳回",
};

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
