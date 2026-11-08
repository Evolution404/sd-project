import { inject, type Ref } from "vue";
import type { Row } from "./api";

export function useAccess() {
  const user = inject<Ref<Row | null>>("currentUser");
  return (permission: string) =>
    Boolean(user?.value?.permissions?.includes(permission));
}
