/**
 * The offline LAN service can run over HTTP, where randomUUID is unavailable.
 */
export function randomRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
