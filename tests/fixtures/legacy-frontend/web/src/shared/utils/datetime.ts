/**
 * Unified human-facing time display. All timestamp values are instants:
 * ISO/Z/offset and legacy SQL UTC "YYYY-MM-DD HH:mm:ss" convert to Beijing
 * time (UTC+08:00) regardless of browser / server host timezone.
 * Calendar-only dates remain YYYY-MM-DD and are never shifted.
 */
const fullInstant = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const timeKeys = /(?:_at|_time|_timestamp|_datetime)$|^(time|timestamp|datetime|last_login)$/i;
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export function isTimestampField(key: string) {
  return timeKeys.test(key);
}
export function looksLikeTimestamp(value: unknown): value is string {
  return typeof value === "string" && fullInstant.test(value.trim());
}
export function formatBeijingDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && dateOnly.test(value.trim())) return value.trim();
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else {
    const raw = value.trim();
    if (!fullInstant.test(raw)) return raw;
    // SQLite's datetime('now') uses UTC without an offset. Never parse an
    // offset-less timestamp using the machine's local timezone.
    const normalized = raw.replace(" ", "T")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized : normalized + "Z");
  }
  if (!Number.isFinite(date.getTime())) return "时间格式异常";
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
export function formatVisibleDateTime(value: unknown, field = ""): unknown {
  if ((isTimestampField(field) || looksLikeTimestamp(value)) &&
      (typeof value === "string" || typeof value === "number" || value instanceof Date)) {
    return formatBeijingDateTime(value);
  }
  return value;
}
