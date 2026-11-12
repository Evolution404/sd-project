<script setup lang="ts">
import { statusText } from "../../../shared/api/client";
import type { ProjectAction } from "../../../../../server/modules/projects/actions";

function workflowGuideId(key: ProjectAction["key"]): string | undefined {
  switch (key) {
    case "link": return "projects.link";
    case "stock": return "projects.stock";
    case "approval": return "projects.approval-draft";
    case "approve": return "projects.approve";
    case "close": return "projects.close";
    case "history": return "projects.history";
    default: return undefined;
  }
}
const props = defineProps<{
  status: string;
  deleted: boolean;
  loading: boolean;
  actions: ProjectAction[];
  canWrite: boolean;
  canAdmin: boolean;
  canDelete: boolean;
}>();
const emit = defineEmits<{
  action: [action: ProjectAction];
  manage: [action: "funding" | "edit" | "history" | "delete"];
}>();
</script>

<template>
  <div class="panel project-current-step" v-loading="loading">
    <div class="toolbar project-action-bar">
      <div>
        <h2>当前阶段 · {{ statusText[status] || status }}</h2>
        <p class="muted">办理顺序依据正式业务状态与当前权限。</p>
      </div>
      <template v-if="actions.length">
        <ElTooltip v-if="actions[0].reason" :content="actions[0].reason">
          <ElButton :data-guide-action="workflowGuideId(actions[0].key)" type="primary" disabled>{{ actions[0].label }}</ElButton>
        </ElTooltip>
        <ElButton v-else :data-guide-action="workflowGuideId(actions[0].key)" type="primary" :disabled="!actions[0].enabled"
          @click="emit('action', actions[0])">{{ actions[0].label }}</ElButton>
      </template>
      <ElDropdown v-if="actions.length > 1" trigger="click"
        @command="item => emit('action', item as ProjectAction)">
        <ElButton>其他办理操作</ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="item in actions.slice(1)" :key="item.key" :data-guide-action="workflowGuideId(item.key)"
              :disabled="!item.enabled" :command="item">{{ item.label }}</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton data-guide-action="projects.funding" v-if="status !== 'closed'" :disabled="!canWrite || deleted"
        @click="emit('manage', 'funding')">资金归属</ElButton>
      <ElDropdown @command="command => emit('manage', command as 'edit' | 'history' | 'delete')">
        <ElButton>更多管理操作</ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem data-guide-action="projects.edit-project" command="edit" :disabled="!canWrite || deleted">修订档案</ElDropdownItem>
            <ElDropdownItem data-guide-action="projects.history" command="history">完整历史（含历次批准）</ElDropdownItem>
            <ElDropdownItem data-guide-action="projects.delete" command="delete" :disabled="!canAdmin || deleted || !canDelete" :title="!canDelete ? '需先处理现有关联与正式结项；未承接的储备/入库项目可直接删除' : undefined" divided>删除项目</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
  </div>
</template>

<style scoped>
.project-current-step {margin-bottom:12px}
.project-action-bar {justify-content:space-between;flex-wrap:wrap;gap:10px}
.project-action-bar h2 {margin:0}
.project-action-bar p {margin:4px 0 0;font-size:12px}
</style>
