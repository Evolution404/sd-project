<template>
  <el-dialog :model-value="true" title="结项核对" width="min(95vw, 980px)" class="project-close-review"
    append-to-body align-center
    :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <div v-loading="loading">
      <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3" show-icon />
      <el-button v-if="error && !loading" class="mb-3" data-guide-action="projects.reload-closure" @click="load">重新读取核对内容</el-button>
      <template v-if="preview">
        <el-alert v-if="preview.reason" type="warning" :title="preview.reason" :closable="false" class="mb-3" />
        <el-descriptions :column="2" border class="mb-4">
          <el-descriptions-item label="采用批准版本">第 {{ preview.approval_version }} 版</el-descriptions-item>
          <el-descriptions-item label="批准预算">{{ projectMoney(preview.summary.approved_budget_fen) }}</el-descriptions-item>
          <el-descriptions-item label="核定实际费用">{{ projectMoney(preview.summary.actual_cost_fen) }}</el-descriptions-item>
          <el-descriptions-item label="生效结算金额">{{ projectMoney(preview.summary.settlement_fen) }}</el-descriptions-item>
          <el-descriptions-item label="已核对费用">{{ projectMoney(preview.summary.reconciled_cost_fen) }}</el-descriptions-item>
          <el-descriptions-item label="待核对费用">{{ projectMoney(preview.summary.unreconciled_cost_fen) }}</el-descriptions-item>
          <el-descriptions-item label="实际费用与批准预算差额">
            {{ projectMoney(preview.summary.budget_difference_fen) }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="preview.summary.locations" border max-height="290" empty-text="没有批准作业位置">
          <el-table-column prop="demand_no" label="需求编号" min-width="130" />
          <el-table-column prop="location_name" label="批准位置" min-width="160" />
          <el-table-column label="批准量" width="100">
            <template #default="{ row }">{{ quantity(row.approved_quantity_scaled) }}</template>
          </el-table-column>
          <el-table-column label="实际解决量" width="110">
            <template #default="{ row }">{{ quantity(row.resolved_quantity_scaled) }}</template>
          </el-table-column>
          <el-table-column label="未完成量" width="100">
            <template #default="{ row }">{{ quantity(row.remaining_quantity_scaled) }}</template>
          </el-table-column>
          <el-table-column label="超出量" width="100">
            <template #default="{ row }">{{ quantity(Math.max(0, row.resolved_quantity_scaled - row.approved_quantity_scaled)) }}</template>
          </el-table-column>
        </el-table>
        <el-alert v-if="preview.release_demands.length" class="mt-3" type="info" :closable="false"
          title="结项将冻结本次核对事实，以下未完成需求将释放剩余工作量供后续项目接续。">
          <ul class="list-disc pl-5">
            <li v-for="row in preview.release_demands" :key="row.project_scope_id">
              需求 {{ row.demand_no }} 尚余 {{ quantity(row.remaining_quantity_scaled) }}
            </li>
          </ul>
        </el-alert>
        <el-form class="mt-4" label-position="top" novalidate :disabled="saving">
          <el-form-item label="结项说明">
            <el-input v-model="reason" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>
      </template>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="close">返回</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading || !preview || Boolean(preview.reason)"
        data-guide-action="projects.close" @click="commit">确认正式结项</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { closeProject, projectClosePreview, projectMoney, type ProjectClosePreview } from "@/api/business/projects";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: []; completed: [] }>();
const preview = ref<ProjectClosePreview>();
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const reason = ref("");
const quantity = (amount: number) => formatScaledDecimal(amount, 4);

function close() {
  if (!saving.value) emit("close");
}

async function load() {
  loading.value = true;
  error.value = "";
  preview.value = undefined;
  try {
    preview.value = await projectClosePreview(props.projectId);
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}

async function commit() {
  if (!preview.value || preview.value.reason || saving.value) return;
  saving.value = true;
  try {
    await closeProject(props.projectId, preview.value, reason.value.trim());
    ElMessage.success("项目已正式结项");
    emit("completed");
  } catch (cause) {
    error.value = (cause as Error).message;
    preview.value = undefined;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
:global(.project-close-review.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
}

:global(.project-close-review .el-dialog__body) {
  min-height: 0;
  overflow: auto;
}
</style>
