import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { requireValue } from "../../shared/errors/business-error.js";

export interface AccessRecord {
  request_id: string;
  time: string;
  ip: string;
  username: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  outcome: string;
  error_type: string;
  error_summary: string;
}
export interface AccessLogOptions {
  clock?: () => Date;
  retentionDays?: number;
  maxFileBytes?: number;
}
const filePattern = /^access-(\d{4}-\d{2}-\d{2})-(\d{6})\.jsonl$/;
const keys: (keyof AccessRecord)[] = ["time", "ip", "username", "method", "path", "status", "duration_ms", "outcome", "request_id", "error_type", "error_summary"];
export function beijingTime(date: Date): string {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
}
// Log only the route shape and bounded business account names. Never persist
// arbitrary URL segments, query strings, credentials, headers or request bodies.
export function safePath(raw: string): string {
  const pathname = raw.split(/[?#]/, 1)[0] || "/";
  return pathname.split("/").slice(0, 12).map(part => {
    if (/^[a-z][a-z-]{0,47}$/.test(part) || /^[a-f0-9-]{36}$/i.test(part) || /^\d{1,8}$/.test(part)) return part;
    return part ? "[redacted]" : "";
  }).join("/").slice(0, 400);
}
export function safeAccount(value: unknown): string {
  return typeof value === "string" && /^[\p{L}\p{N}_.@ -]{1,128}$/u.test(value) ? value : "";
}
export function createAccessLogs(dataDirectory: string, options: AccessLogOptions = {}) {
  const directory = join(dataDirectory, "logs");
  const clock = options.clock || (() => new Date());
  const retentionDays = options.retentionDays ?? Number(process.env.ACCESS_LOG_RETENTION_DAYS || 30);
  const maxFileBytes = options.maxFileBytes ?? Number(process.env.ACCESS_LOG_MAX_FILE_BYTES || 10 * 1024 * 1024);
  requireValue(Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650, "访问日志保留天数须为1至3650");
  requireValue(Number.isInteger(maxFileBytes) && maxFileBytes >= 1024, "访问日志文件上限须至少1024字节");
  let diagnostic = "";
  let lastMaintenance = 0;
  let currentFile = "";
  let currentSize = 0;
  function fault() {
    if (!diagnostic) console.error("ACCESS_LOG_IO_FAILURE 访问日志读写失败，请检查 data/logs 的空间和目录权限");
    diagnostic = "访问日志读写失败，请检查运行目录 data/logs 的空间和目录权限";
  }
  function files(): string[] {
    return readdirSync(directory).filter(name => filePattern.test(name)).sort();
  }
  function maintain() {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const cutoff = beijingTime(new Date(clock().getTime() - (retentionDays - 1) * 86400000)).slice(0, 10);
    for (const name of files()) if (name.slice(7, 17) < cutoff) unlinkSync(join(directory, name));
    lastMaintenance = clock().getTime();
  }
  try { maintain(); } catch { fault(); }
  const timer = setInterval(() => { try { maintain(); } catch { fault(); } }, 3600000);
  timer.unref();
  function record(input: Omit<AccessRecord, "time">): void {
    try {
      if (clock().getTime() - lastMaintenance >= 3600000) maintain();
      const time = beijingTime(clock());
      const line = JSON.stringify({ ...input, time }) + "\n";
      const bytes = Buffer.byteLength(line);
      requireValue(bytes <= maxFileBytes, "访问日志记录超过文件上限");
      const prefix = `access-${time.slice(0, 10)}-`;
      if (!currentFile.startsWith(prefix)) {
        const latest = files().filter(name => name.startsWith(prefix)).at(-1);
        currentFile = latest || prefix + "000001.jsonl";
        currentSize = latest ? statSync(join(directory, latest)).size : 0;
        if (latest && currentSize > 0) {
          const descriptor = openSync(join(directory, latest), "r");
          const lastByte = Buffer.alloc(1);
          try { readSync(descriptor, lastByte, 0, 1, currentSize - 1); }
          finally { closeSync(descriptor); }
          if (lastByte[0] !== 10 && currentSize < maxFileBytes) {
            appendFileSync(join(directory, latest), "\n", "utf8");
            currentSize++;
          }
        }
      }
      if (currentSize + bytes > maxFileBytes) {
        const sequence = Number(currentFile.slice(18, 24)) + 1;
        requireValue(sequence <= 999999, "当日日志文件数量超过上限");
        currentFile = prefix + String(sequence).padStart(6, "0") + ".jsonl";
        currentSize = 0;
      }
      // Synchronous append serializes finish callbacks within this Node server.
      // A record is durable to the OS before another HTTP callback can append.
      appendFileSync(join(directory, currentFile), line, { encoding: "utf8", mode: 0o600 });
      currentSize += bytes;
      diagnostic = "";
    } catch { currentFile = ""; fault(); }
  }
  function criteria(search: URLSearchParams) {
    const filters = Object.fromEntries(["ip", "username", "method", "status", "q", "from", "to"].map(key => [key, search.get(key) || ""]));
    let columnFilters: unknown = {};
    try { columnFilters = JSON.parse(search.get("filters") || "{}"); } catch { requireValue(false, "日志列筛选格式无效"); }
    requireValue(columnFilters && typeof columnFilters === "object" && !Array.isArray(columnFilters), "日志列筛选格式无效");
    const entries = Object.entries(columnFilters);
    requireValue(entries.every(([key, value]) => keys.includes(key as keyof AccessRecord) && typeof value === "string" && value.length <= 400), "日志列筛选无效");
    requireValue(Object.values(filters).every(value => value.length <= 400), "日志查询条件过长");
    for (const key of ["from", "to"]) {
      const value = filters[key];
      if (!value) continue;
      const parsed = new Date(value.replace(" ", "T") + "+08:00");
      requireValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) &&
        Number.isFinite(parsed.getTime()) && beijingTime(parsed) === value, "请输入有效的北京时间范围");
    }
    requireValue(!filters.from || !filters.to || filters.from <= filters.to, "开始时间不能晚于结束时间");
    requireValue(!filters.status || /^[1-5]\d{2}$/.test(filters.status), "响应状态码无效");
    return (row: AccessRecord) => (!filters.from || row.time >= filters.from) && (!filters.to || row.time <= filters.to)
      && ["ip", "username", "method", "status"].every(key => !filters[key] || String(row[key as keyof AccessRecord]) === filters[key])
      && entries.every(([key, value]) => String(row[key as keyof AccessRecord]).toLowerCase().includes(String(value).toLowerCase()))
      && (!filters.q || keys.some(key => String(row[key]).toLowerCase().includes(filters.q.toLowerCase())));
  }
  async function* records(search: URLSearchParams): AsyncGenerator<AccessRecord> {
    const matches = criteria(search);
    let names: string[];
    try { names = files(); } catch { fault(); return; }
    for (const name of names) {
      const stream = createReadStream(join(directory, name), { encoding: "utf8" });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          let row: AccessRecord;
          try { row = JSON.parse(line) as AccessRecord; } catch { fault(); continue; }
          if (row && keys.every(key => typeof row[key] === (["status", "duration_ms"].includes(key) ? "number" : "string")) && matches(row)) {
            // Project the documented fields when reading and exporting as well.
            yield Object.fromEntries(keys.map(key => [key, row[key]])) as unknown as AccessRecord;
          }
        }
      } catch { fault(); } finally { lines.close(); stream.destroy(); }
    }
  }
  async function query(search: URLSearchParams) {
    const page = Number(search.get("page") || 1), pageSize = Number(search.get("page_size") || 30);
    requireValue(Number.isInteger(page) && page > 0 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 200 && page * pageSize <= 100000, "日志分页范围无效");
    const sort = search.get("sort") || "time";
    requireValue(keys.includes(sort as keyof AccessRecord), "日志排序字段无效");
    const direction = search.get("direction") || "desc";
    requireValue(["asc", "desc"].includes(direction), "日志排序方向无效");
    const limit = page * pageSize;
    let rows: AccessRecord[] = [], total = 0;
    function compare(a: AccessRecord, b: AccessRecord) {
      const left = a[sort as keyof AccessRecord], right = b[sort as keyof AccessRecord];
      const result = left < right ? -1 : left > right ? 1 : a.request_id.localeCompare(b.request_id);
      return direction === "asc" ? result : -result;
    }
    for await (const row of records(search)) {
      total++;
      rows.push(row);
      if (rows.length >= limit + 1000) rows = rows.sort(compare).slice(0, limit);
    }
    rows.sort(compare);
    return { items: rows.slice((page - 1) * pageSize, limit), total, page, page_size: pageSize,
      diagnostic, retention_days: retentionDays, max_file_bytes: maxFileBytes };
  }
  return { record, query, records, validate: criteria, close: () => clearInterval(timer) };
}
