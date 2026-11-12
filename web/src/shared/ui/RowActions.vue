<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import type { DropdownInstance } from "element-plus";
import { MoreFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

export type RowAction = {
  label: string;
  run: () => unknown;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  /** Semantic help only; no dispatch or selection is derived from this id. */
  guideActionId?: string;
};
const props = defineProps<{ actions: RowAction[] }>();
const busy = ref(false);
const dropdown = ref<DropdownInstance>();
function closeMenuOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  dropdown.value?.handleClose();
}
function menuVisibilityChanged(visible: boolean) {
  if (visible) window.addEventListener("keydown", closeMenuOnEscape, true);
  else window.removeEventListener("keydown", closeMenuOnEscape, true);
}
onUnmounted(() => window.removeEventListener("keydown", closeMenuOnEscape, true));
const primary = computed(() =>
  props.actions.find(action => action.primary && !action.disabled && !action.danger)
    || props.actions.find(action => !action.disabled && !action.danger)
    || props.actions[0],
);
const secondary = computed(() => props.actions.filter(action => action !== primary.value));
async function invoke(action: RowAction) {
  if (action.disabled || busy.value) return;
  // A modal may mount synchronously from the action. Always close the
  // teleported menu before running it to prevent a stale open menu on return.
  dropdown.value?.handleClose();
  busy.value = true;
  try {
    await action.run();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="row-actions">
    <ElButton v-if="primary" :data-guide-action="primary.guideActionId" size="small" :disabled="primary.disabled" :loading="busy"
      :type="primary.danger ? 'danger' : undefined" @click="invoke(primary)">{{ primary.label }}</ElButton>
    <ElDropdown v-if="secondary.length" ref="dropdown" trigger="click" placement="bottom-end"
      @command="invoke" @visible-change="menuVisibilityChanged">
      <ElButton text size="small" :disabled="busy" aria-label="更多操作">
        更多<ElIcon><MoreFilled /></ElIcon>
      </ElButton>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem v-for="(action, index) in secondary" :key="action.label" :data-guide-action="action.guideActionId"
            :command="action" :disabled="action.disabled || busy"
            :divided="action.danger && !secondary[index - 1]?.danger"
            :class="{ 'row-action-danger': action.danger }">{{ action.label }}</ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </div>
</template>
<style scoped>
.row-actions{display:flex;align-items:center;gap:6px;white-space:nowrap}
.row-actions .el-button+.el-button{margin-left:0}
.row-actions .el-icon{margin-left:4px}
.row-action-danger:not(.is-disabled){color:var(--el-color-danger)}
</style>
