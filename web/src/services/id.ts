/**
 * Cryptographic UUID v4 generator that works on ordinary LAN HTTP origins.
 * crypto.randomUUID() requires a secure context; getRandomValues() does not.
 * Never use Math.random() for idempotency or persistent field identities.
 */
export function newClientId(): string {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("浏览器不支持安全随机数，请使用受支持的现代浏览器");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
