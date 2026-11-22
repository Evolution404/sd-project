import { computed, ref, shallowRef } from "vue";
import { ElMessage } from "element-plus";
import { api, ApiError } from "../api/client";
import type { HandlingReviewRow, HandlingTarget } from "../../../../server/shared/types/handling-batch";

interface ReviewRequest {
  title: string;
  description: string;
  targets: HandlingTarget[];
  previewPath: string;
  commitPath: string;
  payload?: (targets: HandlingTarget[]) => object;
  complete: (ids: string[]) => unknown;
}

export function useHandlingReview() {
  const request = shallowRef<ReviewRequest | null>(null);
  const open = ref(false), loading = ref(false), saving = ref(false), error = ref("");
  const recovery = ref<"" | "check" | "submit">("");
  const rows = ref<HandlingReviewRow[]>([]);
  const ready = computed(() => rows.value.filter(row => !row.reason));
  let sequence = 0;

  async function review(config: ReviewRequest) {
    if (!config.targets.length || config.targets.length > 100 || saving.value) return;
    const token = ++sequence;
    request.value = config;
    rows.value = [];
    error.value = "";
    recovery.value = "";
    loading.value = true;
    open.value = true;
    try {
      const result = await api<HandlingReviewRow[]>(config.previewPath, "POST",
        config.payload?.(config.targets) ?? { items: config.targets });
      if (token === sequence) rows.value = result;
    } catch (failure) {
      if (token === sequence) {
        error.value = (failure as Error).message;
        recovery.value = "check";
      }
    } finally {
      if (token === sequence) loading.value = false;
    }
  }
  function recheck() {
    if (request.value && recovery.value === "check" && !saving.value && !loading.value)
      return review(request.value);
  }
  async function commit() {
    const config = request.value;
    if (!config || !ready.value.length || (error.value && recovery.value !== "submit") || loading.value || saving.value) return;
    const targets = ready.value.map(({ id, expected_version, expected_event_seq }) =>
      ({ id, expected_version, expected_event_seq }));
    saving.value = true;
    error.value = "";
    recovery.value = "";
    try {
      await api(config.commitPath, "POST", config.payload?.(targets) ?? { items: targets });
    } catch (failure) {
      error.value = (failure as Error).message;
      recovery.value = failure instanceof ApiError && (failure.code === "WRITE_RESULT_UNKNOWN" || failure.status >= 500)
        ? "submit" : "check";
      return;
    } finally {
      saving.value = false;
    }
    open.value = false;
    ElMessage.success("已办理 " + targets.length + " 条");
    await config.complete(targets.map(target => target.id));
  }
  function close() {
    if (saving.value) return;
    sequence++;
    loading.value = false;
    open.value = false;
  }
  return { request, open, loading, saving, error, recovery, rows, ready, review, recheck, commit, close };
}
