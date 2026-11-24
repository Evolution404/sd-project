/** Y1 adapter for the existing same-origin HttpOnly Cookie server. */
export interface LegacyActor {
  id: string; username: string;
  role: "admin" | "editor" | "verifier" | "viewer";
  roles?: string[];
  display_name?: string;
  permissions: string[];
  password_change_required?: boolean;
}
export interface AccountProfile {
  username:string; display_name:string; employee_no:string|null; role_names:string[];
  created_at:string; permission_count:number;
}
export interface OwnSession {
  id:string; current:boolean; created_at:string; expires_at:string;
}
async function body<T>(response: Response): Promise<T> {
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "message" in result
      ? String(result.message) : "请求失败";
    throw new Error(message);
  }
  return result as T;
}
export async function loginSession(username: string, password: string): Promise<LegacyActor> {
  return body(await fetch("/api/login", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }));
}
export async function currentSession(): Promise<LegacyActor> {
  return body(await fetch("/api/session", { credentials: "same-origin" }));
}
export async function logoutSession(): Promise<void> {
  await body(await fetch("/api/logout", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: "{}" }));
}
export async function accountProfile():Promise<AccountProfile> {
  return body(await fetch("/api/me",{credentials:"same-origin"}));
}
export async function ownSessions():Promise<OwnSession[]> {
  return body(await fetch("/api/me/sessions",{credentials:"same-origin"}));
}
export async function revokeOwnSession(id:string):Promise<{current:boolean}> {
  return body(await fetch("/api/me/sessions/"+encodeURIComponent(id),{method:"DELETE",credentials:"same-origin"}));
}
export async function changeAccountPassword(currentPassword:string,newPassword:string):Promise<void> {
  await body(await fetch("/api/me/password",{ method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({current_password:currentPassword,new_password:newPassword}) }));
}
