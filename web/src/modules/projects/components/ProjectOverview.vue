<script setup lang="ts">
import { money } from "../../../shared/api/client";

import type { ProjectOverviewFacts, ProjectFinanceSnapshot, ProjectReference } from "./types";
defineProps<{
  project: ProjectOverviewFacts;
  summary: ProjectFinanceSnapshot | null;
  framework: ProjectReference | null;
  agreement: ProjectReference | null;
  loading: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  deleteReason: string;
  closeReason?: string;
  descriptionColumns: number;
}>();
const emit = defineEmits<{
  fund: [kind: "frameworks" | "agreements", id: string];
  edit: [];
  remove: [];
  close: [];
}>();
</script>

<template>
  <div class="panel" v-loading="loading">
    <div class="toolbar" v-if="project.approval"><h2>当前批准与费用</h2></div>
    <div class="toolbar" v-else><h2>项目档案</h2>
      <ElButton v-if="canWrite && !project.deleted && project.status !== 'closed'" data-guide-action="projects.edit-project" @click="emit('edit')">编辑档案</ElButton>
    </div>
    <div v-if="project.approval" class="project-overview-metrics">
      <div><span>当前关联需求</span><strong>{{ project.scopes.filter(scope => !!scope.binding).length }} 项</strong></div>
      <div><span>当前批准范围</span><strong>{{ project.approval ? '第' + project.approval.version_no + '版' : '尚未批准' }}</strong></div>
      <div><span>批准预算</span><strong>{{ project.approval ? '¥' + money(project.approval.approved_budget_fen) : '未批准' }}</strong></div>
      <div><span>真实费用</span><strong>{{ summary ? '¥' + money(summary.actual_cost_fen) : '查询中' }}</strong></div>
      <div><span>已批准结算</span><strong>{{ summary ? '¥' + money(summary.settlement_fen) : '查询中' }}</strong></div>
      <div><span>待核对费用</span><strong>{{ summary ? '¥' + money(summary.unreconciled_cost_fen) : '查询中' }}</strong></div>
    </div>
    <ElDescriptions :column="descriptionColumns" border class="project-context-descriptions">
      <ElDescriptionsItem label="所属年度框架">
        <ElButton link type="primary" :disabled="!framework"
          @click="emit('fund', 'frameworks', project.framework_id)">
          {{ framework?.name || '查看年度框架' }}
        </ElButton>
      </ElDescriptionsItem>
      <ElDescriptionsItem label="归属方式">
        <ElButton v-if="agreement" link type="primary"
          @click="emit('fund', 'agreements', agreement.id)">通过执行协议 · {{ agreement.name }}</ElButton>
        <span v-else>直接归属年度框架（无需执行协议）</span>
      </ElDescriptionsItem>
      <ElDescriptionsItem label="计划结束日期">{{ project.planned_end_on || '未指定' }}</ElDescriptionsItem>
    </ElDescriptions>
    <div v-if="project.status === 'approved' && closeReason !== undefined" class="toolbar project-section-actions">
      <ElButton data-guide-action="projects.close" :disabled="!!closeReason" @click="emit('close')">结项核对</ElButton>
      <span v-if="closeReason" class="muted">{{ closeReason }}</span>
    </div>
  </div>
  <div class="panel">
    <div class="toolbar" v-if="project.approval">
      <h2>项目档案</h2>
      <span v-if="project.status === 'closed'" class="muted">结项后档案已冻结</span>
      <ElButton v-if="canWrite && !project.deleted && project.status !== 'closed'" data-guide-action="projects.edit-project" @click="emit('edit')">编辑档案</ElButton>
    </div>
    <ElDescriptions :column="descriptionColumns" border>
      <ElDescriptionsItem label="项目类别">{{ project.category_name || "未指定" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="归口单位">{{ project.managing_unit_name || "未指定" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="责任人">{{ project.owner_username || "未指定" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="管理人员">{{ project.manager_username || "未指定" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="计划期间">
        {{ project.planned_start_on || "未指定" }} 至 {{ project.planned_end_on || "未指定" }}
      </ElDescriptionsItem>
      <ElDescriptionsItem label="初步估算">{{ money(project.preliminary_estimate_fen) }}</ElDescriptionsItem>
    </ElDescriptions>
    <div v-if="canAdmin && !project.deleted" class="toolbar project-section-actions">
      <ElButton data-guide-action="projects.delete" plain type="danger" :disabled="!!deleteReason" @click="emit('remove')">删除项目</ElButton>
      <span v-if="deleteReason" class="muted">{{ deleteReason }}</span>
    </div>
  </div>
</template>

<style scoped>
.project-overview-metrics {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}
.project-overview-metrics > div {border:1px solid var(--edge);border-radius:12px;padding:14px;min-width:0}
.project-overview-metrics span {display:block;font-size:12px;color:var(--muted);margin-bottom:8px}
.project-overview-metrics strong {display:block;font-size:18px;font-weight:650;overflow-wrap:anywhere}
.project-context-descriptions,.project-section-actions {margin-top:14px}
@media(max-width:800px){.project-overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:480px){.project-overview-metrics{grid-template-columns:1fr}}
</style>
