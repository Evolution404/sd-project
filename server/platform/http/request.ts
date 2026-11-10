import type { IncomingMessage } from "node:http";
import { requireValue, BusinessError } from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";

export async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    requireValue(size <= 17 * 1024 * 1024, "请求超过大小限制", 413);
    chunks.push(bytes);
  }
  const buffer = Buffer.concat(chunks);
  if (request.headers["content-type"] === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return buffer;
  requireValue((request.headers["content-type"] || "").startsWith("application/json") || !buffer.length, "请求类型无效", 415);
  let parsed: unknown;
  try { parsed = buffer.length ? JSON.parse(buffer.toString("utf8")) : {}; }
  catch { throw new BusinessError("JSON格式错误", 400); }
  requireValue(isObject(parsed), "请求正文必须为JSON对象", 400);
  return parsed;
}
