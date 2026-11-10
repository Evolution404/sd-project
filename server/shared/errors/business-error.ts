import type { FieldErrors } from "../types/contracts.js";

const statusCodes: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "AUTHENTICATION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "VERSION_CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "BUSINESS_VALIDATION",
  429: "RATE_LIMITED",
};

export class BusinessError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors;

  constructor(message: string, status = 422, fields: FieldErrors = {}, code?: string) {
    super(message);
    this.name = "BusinessError";
    this.status = status;
    this.code = code || statusCodes[status] || "INTERNAL_ERROR";
    this.fields = fields;
  }
}

export function requireValue(condition: unknown, message: string, status = 422, fields?: FieldErrors): asserts condition {
  if (!condition) throw new BusinessError(message, status, fields);
}

export function expectedVersion(actual: unknown, expected: unknown): void {
  requireValue(Number.isSafeInteger(expected) && actual === expected,
    "版本冲突，请刷新后重新核对", 409);
}

export function integer(value: unknown, label: string, minimum = 0): number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum,
    `${label}必须为大于等于${minimum}的安全整数`);
  return value;
}

export function text(value: unknown, label: string): string {
  requireValue(typeof value === "string" && value.trim().length > 0, `请填写${label}`);
  return value.trim();
}
