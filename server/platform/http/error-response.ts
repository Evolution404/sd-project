import { BusinessError } from "../../shared/errors/business-error.js";
import type { ErrorResponse } from "../../shared/types/contracts.js";

export function errorResponse(error: unknown): { status: number; body: ErrorResponse } {
  if (error instanceof BusinessError) {
    return { status: error.status, body: { code: error.code, message: error.message, fields: error.fields } };
  }
  const message = error instanceof Error ? error.message : "";
  let publicMessage = "";
  if (/UNIQUE constraint failed/.test(message)) publicMessage = "编号或唯一业务标识已存在，请刷新核对";
  else if (/FOREIGN KEY constraint failed/.test(message)) publicMessage = "关联记录不存在或仍被引用，请刷新核对";
  else if (/(?:CHECK|NOT NULL) constraint failed/.test(message)) publicMessage = "填写内容不符合业务约束，请检查必填值和范围";
  else if (/constraint|不可|必须|不能|禁止|不得|拒绝|已关联/.test(message)) publicMessage = message;
  return {
    status: publicMessage ? 422 : 500,
    body: { code: publicMessage ? "INTEGRITY_CONFLICT" : "INTERNAL_ERROR", message: publicMessage || "服务内部错误", fields: {} },
  };
}
