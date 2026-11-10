import { inject, type Ref } from "vue";
import type { Actor } from "../../../../server/shared/types/contracts";

export function useAccess() {
  const user = inject<Ref<Actor | null>>("currentUser");
  return (permission: string) =>
    Boolean(user?.value?.permissions?.includes(permission));
}
