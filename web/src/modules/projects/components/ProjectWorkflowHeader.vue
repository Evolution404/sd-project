<script setup lang="ts">
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
  displayStatus: string;
  deleted: boolean;
  loading: boolean;
  actions: ProjectAction[];
  canWrite: boolean;
  canAdmin: boolean;
  canDelete: boolean;
}>();
const emit = defineEmits<{
  action: [action: ProjectAction];
  manage: [action: "edit" | "history" | "delete"];
}>();
</script>

<template>
  <div class="panel project-current-step" v-loading="loading">
    <div class="project-action-bar">
      <div class="project-stage-copy">
        <h2>当前项目状态 · {{ displayStatus }}</h2>
        <p class="muted">优先办理下一步；年度框架与执行协议在项目档案中维护。</p>
      </div>
      <div class="project-action-controls">
        <div class="project-next-actions" aria-label="项目办理操作">
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
                  :disabled="!item.enabled" :command="item" :title="item.reason || undefined">{{ item.label }}</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
        <div class="project-management-actions" aria-label="项目档案和历史操作">
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
    </div>
  </div>
</template>

<style scoped>
.project-current-step {margin-bottom:14px}
.project-action-bar {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.project-stage-copy {min-width:175px;flex:1 1 220px}
.project-action-bar h2 {margin:0;font-size:16px;font-weight:650}
.project-action-bar p {margin:6px 0 0;font-size:12px;line-height:1.55}
.project-action-controls {display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:12px}
.project-next-actions,.project-management-actions {display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.project-management-actions {padding-left:12px;border-left:1px solid var(--edge)}
.project-next-actions :deep(.el-button+.el-button),
.project-management-actions :deep(.el-button+.el-button) {margin-left:0}
@media(max-width:850px){
  .project-stage-copy {flex:1 1 100%}
  .project-action-controls {justify-content:flex-start}
}
@media(max-width:540px){
  .project-management-actions {padding-left:0;border-left:0}
}
</style>
