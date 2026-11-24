import { store } from "@/stores";
import type { LoginRequest } from "@/api/auth";
import type { UserInfo } from "@/api/system/user";
import { usePermissionStoreHook } from "@/stores/permission";
import { useDictStoreHook } from "@/stores/dict";
import { useTagsViewStore } from "@/stores";
import { loginSession, currentSession, logoutSession, type LegacyActor } from "@/api/business/session";
import router from "@/router";

/** Y1 Cookie integration: preserves upstream Pinia interface, no browser-stored tokens. */
function fromActor(a: LegacyActor): UserInfo {
  return { userId: a.id, username: a.username, nickname: a.display_name || a.username, roles: a.roles || [a.role], perms: a.permissions };
}
export const useUserStore = defineStore("user", () => {
  const userInfo = ref<UserInfo>({ roles: [], perms: [] });
  const rememberMe = ref(false);
  const authenticated = ref(false);
  const passwordChangeRequired = ref(false);
  let revision = 0;
  let expired = false;
  async function login(input: LoginRequest) {
    const actor = await loginSession(input.username, input.password);
    revision++;
    userInfo.value = fromActor(actor);
    passwordChangeRequired.value = Boolean(actor.password_change_required);
    authenticated.value = true; expired = false;
  }
  async function fetchUserInfo(): Promise<UserInfo> {
    const captured = revision;
    const actor = await currentSession();
    if (captured !== revision) throw new Error("登录会话已切换");
    userInfo.value = fromActor(actor);
    passwordChangeRequired.value = Boolean(actor.password_change_required);
    authenticated.value = true; expired = false;
    return userInfo.value;
  }
  function resetUserState() {
    revision++; authenticated.value = false; passwordChangeRequired.value = false; userInfo.value = { roles: [], perms: [] };
  }
  function resetAllState() {
    resetUserState();
    usePermissionStoreHook().resetRouter();
    useDictStoreHook().clearDictCache();
    void useTagsViewStore().delAllViews();
  }
  async function logout(): Promise<string | null> {
    try { await logoutSession(); return null; }
    finally { resetAllState(); }
  }
  async function redirectToLogin() {
    if (expired) return;
    expired = true;
    const current = router.currentRoute.value;
    const redirect = current.path === "/login" ? current.query.redirect as string | undefined : current.fullPath;
    const href=router.resolve({path:"/login",
      query:redirect && !redirect.startsWith("/login")?{redirect}:{} }).href;
    resetAllState();
    // Full navigation evicts all cached protected views and prevents stale route re-entry.
    window.location.replace(href);
  }
  const refreshTokenOnce = async () => {};
  const waitRefresh = async () => {};
  return { userInfo, rememberMe, passwordChangeRequired, isLoggedIn: () => authenticated.value,
    login, logout, fetchUserInfo, resetAllState, resetUserState,
    isSessionExpired: () => expired, redirectToLogin, refreshTokenOnce, waitRefresh };
});
export function useUserStoreHook() { return useUserStore(store); }
