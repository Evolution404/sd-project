import { useUserStoreHook } from "@/stores/user";

/**
 * 与权限指令共用；*:*:* 作为组件约定表示无需权限
 */
export function hasPerm(value: string | string[]): boolean {
  const { perms } = useUserStoreHook().userInfo;
  const requiredPerms = Array.isArray(value) ? value : [value];
  return (
    requiredPerms.includes("*:*:*") ||
    requiredPerms.some((perm) => perms.includes(perm))
  );
}
