import type { FieldErrors } from "../../../../server/shared/types/contracts";
import { newClientId } from "../utils/id";

export type Row = Record<string, any>;
export class ApiError extends Error {
  fields: FieldErrors;
  code: string;
  status: number;
  constructor(message: string, fields: FieldErrors = {}, code = "REQUEST_FAILED", status = 0) {
    super(message);
    this.fields = fields;
    this.code = code;
    this.status = status;
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api" + path, {
    signal,
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "Idempotency-Key": newClientId() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(result.message || "请求失败", result.fields, result.code, response.status);
  }
  return result;
}
export async function download(path: string, filename?: string) {
  const response = await fetch("/api" + path, { credentials: "same-origin" });
  if (!response.ok) throw new Error((await response.json()).message);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  const encodedName = response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  link.download = encodedName ? decodeURIComponent(encodedName) : filename || "下载文件";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
export const statusText: Record<string, string> = {
  straight: "直线塔",
  tension: "耐张塔",
  create: "新增",
  new: "新建实物",
  shared: "共用已有实物",
  distinct: "已确认不同实物",
  replace: "整基更换",
  update: "修改",
  unchanged: "保持原值",
  delete: "删除",
  revise: "更正",
  correct: "更正",
  note: "补充说明",
  linked: "关联",
  released: "解绑",
  void: "正式注销",
  voided: "已撤销",
  revision: "正式修订",
  admin: "管理员",
  editor: "编辑人员",
  verifier: "审核人员",
  viewer: "只读人员",
  disabled: "禁用",
  main: "主线",
  branch: "支线",
  line: "线路",
  physical: "杆塔",
  tower: "杆塔",
  span: "档距",
  physical_tower: "物理杆塔",
  logical_tower: "逻辑杆塔",
  body: "本体",
  corridor: "通道",
  fixed: "固定金额",
  per_unit: "数量乘单价",
  base_plus_unit: "基础费加单价",
  quantity_bracket: "整批数量阶梯",
  progressive_bracket: "累进阶梯",
  group: "按组计价",
  rate: "比例计价",
  composite: "组合费用",
  work_location: "逐作业位置",
  work_batch: "批次",
  project: "项目",
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
