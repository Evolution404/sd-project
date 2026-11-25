<script setup lang="ts">
import BusinessHistory from "../../../shared/ui/BusinessHistory.vue";
import { ref, computed, watch } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import type {
  CostCategoryNode,
  CostCategoryDetail,
  CategoryCost,
} from "../../../../../server/shared/types/trees";
import { api, money, statusText } from "../../../shared/api/client";
import { useAccess } from "../../../shared/composables/use-access";
import { useDialogDraftGuard } from "../../../shared/forms/use-dialog-draft";
import { treePath, descendantIds } from "../../../shared/utils/tree";
import BusinessTree from "../../../shared/ui/BusinessTree.vue";
import BusinessTreeSelect from "../../../shared/ui/BusinessTreeSelect.vue";
import BusinessTable, {
  type TableColumn,
} from "../../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../../shared/ui/BusinessDetailDialog.vue";
const costColumns: TableColumn[] = [
  { key: "title", label: "费用事项" },
  { key: "cost_node_name", label: "采用科目名称" },
  { key: "amount_fen", label: "金额" },
  { key: "occurred_on", label: "发生日期" },
  { key: "status", label: "状态" },
].map((column) => ({ ...column, sortable: false, filterable: false }));
const props = defineProps<{
  projectId: string;
  readonly?: boolean;
  snapshot?: CostCategoryNode[];
}>();
const emit = defineEmits<{ changed: [] }>();
const can = useAccess(),
  nodes = ref<CostCategoryNode[]>([]),
  selectedId = ref<string | null>(null);
const mobilePane = ref<"list" | "detail">("list");
const loading = ref(false),
  error = ref(""),
  includeDeleted = ref(false),
  detail = ref<CostCategoryDetail | null>(null),
  page = ref(1);
const selected = computed(() =>
  nodes.value.find((node) => node.id === selectedId.value),
);
const path = computed(() =>
  selectedId.value
    ? treePath(nodes.value, selectedId.value)
        .map((node) => node.name)
        .join(" / ")
    : "",
);
const visible = computed(() => {
  if (includeDeleted.value) return nodes.value;
  const ids = new Set<string>();
  for (const node of nodes.value)
    if (!node.deleted)
      for (const parent of treePath(nodes.value, node.id)) ids.add(parent.id);
  return nodes.value.filter((node) => ids.has(node.id));
});
const leaves = computed(() => {
  if (!selectedId.value) return [];
  const ids = descendantIds(nodes.value, selectedId.value);
  ids.add(selectedId.value);
  return nodes.value.filter((node) => ids.has(node.id) && !node.child_count);
});
let sequence = 0;
async function load() {
  loading.value = true;
  error.value = "";
  try {
    nodes.value = await api<CostCategoryNode[]>(
      `/projects/${props.projectId}/cost-tree`,
    );
    const saved =
      selectedId.value ||
      sessionStorage.getItem("sd-cost-node:" + props.projectId);
    selectedId.value = nodes.value.some((node) => node.id === saved)
      ? saved
      : visible.value[0]?.id || null;
    if (selected.value?.deleted) includeDeleted.value = true;
    await loadDetail();
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadDetail() {
  const id = selectedId.value,
    current = ++sequence;
  if (!id) {
    detail.value = null;
    return;
  }
  detail.value = null;
  error.value = "";
  try {
    const value = await api<CostCategoryDetail>(
      `/projects/${props.projectId}/cost-tree/${id}?page=${page.value}`,
    );
    if (current === sequence) detail.value = value;
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  }
}
watch(
  () => props.snapshot,
  (value) => {
    if (!value) return;
    nodes.value = value;
    if (!value.some((node) => node.id === selectedId.value))
      selectedId.value = visible.value[0]?.id || null;
    void loadDetail();
  },
);
watch(selectedId, (value) => {
  if (value) mobilePane.value = "detail";
  page.value = 1;
  if (value) sessionStorage.setItem("sd-cost-node:" + props.projectId, value);
  void loadDetail();
});
watch(
  () => props.projectId,
  () => {
    selectedId.value = null;
    void load();
  },
  { immediate: true },
);
const editor = ref(false),
  editing = ref<CostCategoryNode | null>(null),
  saving = ref(false),
  formRef = ref<FormInstance>();
const form = ref({
  name: "",
  status: "active",
  parent_id: null as string | null,
});
const guard = useDialogDraftGuard(() => form.value);
function edit(node?: CostCategoryNode, parent?: string) {
  editing.value = node || null;
  form.value = {
    name: node?.name || "",
    status: node?.status || "active",
    parent_id: node?.parent_id || parent || null,
  };
  editor.value = true;
  guard.capture();
}
const parents = computed(() =>
  nodes.value.map((node) => ({
    ...node,
    disabled: !node.can_add_child,
    disabled_reason: node.can_add_child
      ? ""
      : node.reference_count
        ? "已有费用或结算引用，保留末级身份"
        : node.disabled_reason,
  })),
);
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate())) return;
    const value = await api<{ id: string }>(
      `/projects/${props.projectId}/nodes${editing.value ? "/" + editing.value.id : ""}`,
      "POST",
      {
        name: form.value.name,
        status: form.value.status,
        ...(editing.value
          ? { expected_version: editing.value.version_no }
          : { parent_id: form.value.parent_id }),
      },
    );
    selectedId.value = value.id;
    editor.value = false;
    await load();
    emit("changed");
    ElMessage.success("费用科目已保存");
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  } finally {
    saving.value = false;
  }
}
async function remove() {
  const node = selected.value;
  if (!node) return;
  try {
    const latest = (
      await api<CostCategoryNode[]>(`/projects/${props.projectId}/cost-tree`)
    ).find((item) => item.id === node.id)!;
    await ElMessageBox.confirm(
      `该科目有${latest.child_count}个直属下级、${latest.reference_count}项正式引用。删除保留原科目、下级和业务历史，新增引用将停止。`,
      "删除费用科目",
      { type: "warning" },
    );
    await api(`/projects/${props.projectId}/nodes/${node.id}`, "DELETE", {
      expected_version: latest.version_no,
      expected_references: latest.reference_count,
      expected_children: latest.child_count,
    });
    includeDeleted.value = true;
    await load();
    emit("changed");
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
const historyOpen = ref(false);
const costView = ref<CategoryCost | null>(null);
function viewCost(entryId: string) {
  costView.value = detail.value?.items.find(item => item.entry_id === entryId) ?? null;
}
</script>
<template>
  <section class="panel cost-category-workspace">
    <div class="toolbar">
      <h2>费用科目</h2>
      <ElPopover trigger="click" placement="bottom-end" :width="190">
        <template #reference><ElButton>筛选科目</ElButton></template>
        <ElCheckbox data-guide-action="finance.category-show-deleted" v-model="includeDeleted">包含已删除科目</ElCheckbox>
      </ElPopover>
      <ElTag v-if="includeDeleted" effect="plain">包含已删除科目</ElTag>
      <ElButton :loading="loading" @click="load">刷新科目</ElButton>
      <ElButton v-if="can('write')" data-guide-action="finance.category-create" type="primary" :disabled="readonly" @click="edit()">新增科目</ElButton>
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false"
      ><ElButton text @click="load">重试</ElButton></ElAlert
    >
    <div class="mobile-tree-switch" role="group" aria-label="科目视图切换">
      <ElButton :type="mobilePane === 'list' ? 'primary' : 'default'" @click="mobilePane = 'list'">科目列表</ElButton>
      <ElButton :type="mobilePane === 'detail' ? 'primary' : 'default'" :disabled="!selected" @click="mobilePane = 'detail'">科目详情</ElButton>
    </div>
    <div class="tree-workspace" :class="'mobile-pane-' + mobilePane">
      <BusinessTree
        v-model="selectedId"
        :nodes="visible"
        label="费用科目"
        :loading="loading"
        ><template #empty
          ><ElButton data-guide-action="finance.category-root" :disabled="readonly || !can('write')" @click="edit()"
            >新增根科目</ElButton
          ></template
        ></BusinessTree
      >
      <section v-if="selected" class="tree-facts">
        <ElButton class="mobile-back" text @click="mobilePane = 'list'">返回列表</ElButton>
        <div class="subheading">
          {{ selected.name }}
          <ElTag :type="selected.deleted ? 'danger' : 'info'">{{
            selected.deleted ? "已删除" : statusText[selected.status]
          }}</ElTag>
        </div>
        <p class="tree-path">{{ path }}</p>
        <div class="toolbar">
          <ElButton data-guide-action="finance.category-child"
            :disabled="readonly || !can('write') || !selected.can_add_child"
            :title="
              selected.can_add_child
                ? ''
                : selected.reference_count
                  ? '已有费用或结算，保留末级身份'
                  : selected.disabled_reason
            "
            @click="edit(undefined, selected.id)"
            >新增下级</ElButton
          ><ElButton data-guide-action="finance.category-edit"
            :disabled="readonly || !can('write') || selected.deleted"
            @click="edit(selected)"
            >编辑版本</ElButton
          ><ElButton data-guide-action="finance.category-history" @click="historyOpen = true">版本与删除历史</ElButton
          ><ElButton class="category-delete-action" data-guide-action="finance.category-delete"
            type="danger" plain
            :disabled="readonly || !can('admin') || selected.deleted"
            @click="remove"
            >删除科目</ElButton
          >
        </div>
        <ElDescriptions :column="1" :label-width="150" border
          ><ElDescriptionsItem label="正式版本"
            >第{{ selected.version_no }}版</ElDescriptionsItem
          ><ElDescriptionsItem label="直属下级">{{
            selected.child_count
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="所含末级科目">{{
            leaves.length ? leaves.slice(0, 5).map((node) => node.name).join("、") + (leaves.length > 5 ? ` 等${leaves.length}项` : "") : "—"
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="当前有效实际费用"
            >¥{{ money(selected.actual_cost_fen) }}</ElDescriptionsItem
          ><ElDescriptionsItem label="正式结算金额"
            >¥{{ money(selected.settlement_fen) }}</ElDescriptionsItem
          ></ElDescriptions
        >
        <h3>关联实际费用</h3>
        <BusinessTable
          :max-height="380"
          client-side
          :table-key="'cost-tree:details:' + projectId"
          :rows="detail?.items || []"
          :columns="costColumns"
        >
          <template #cell="{ row, column, value }"
            ><span v-if="column.key === 'amount_fen'">{{
              money(row.amount_fen)
            }}</span
            ><span v-else-if="column.key === 'status'">{{
              row.deleted ? "已删除" : statusText[row.status]
            }}</span
            ><span v-else>{{ value }}</span></template
          ><template #actions="{ row }"
            ><ElButton size="small" @click="viewCost(String(row.entry_id))"
              >查看费用</ElButton
            ></template
          > </BusinessTable
        ><ElPagination
          v-model:current-page="page"
          :total="detail?.total || 0"
          :page-size="30"
          layout="prev,pager,next,total"
          @current-change="loadDetail"
        />
      </section>
      <ElEmpty v-else description="选择科目查看层级和费用" :image-size="70" />
    </div>
    <ElDialog
      v-model="editor"
      append-to-body
      title="费用科目版本"
      width="620px"
      :close-on-click-modal="false"
      :before-close="
        (done: () => void) => {
          void guard.confirmClose(done);
        }
      "
    >
      <ElForm ref="formRef" :model="form" label-position="top" novalidate
        ><ElFormItem
          label="名称"
          prop="name"
          :rules="[{ required: true, message: '请填写名称' }]"
          ><ElInput v-model="form.name" /></ElFormItem
        ><ElFormItem label="上级科目"
          ><span v-if="editing"
            >{{
              editing.parent_id
                ? treePath(nodes, editing.parent_id)
                    .map((node) => node.name)
                    .join(" / ")
                : "根科目"
            }}。费用科目建立后保留原层级。</span
          ><BusinessTreeSelect
            v-else
            v-model="form.parent_id"
            :nodes="parents"
            placeholder="选择上级，留空建立根科目" /></ElFormItem
        ><ElFormItem label="状态"
          ><ElSelect v-model="form.status"
            ><ElOption label="启用" value="active" /><ElOption
              label="停用"
              value="inactive" /></ElSelect></ElFormItem
      ></ElForm>
      <template #footer
        ><ElButton
          @click="
            guard.confirmClose(() => {
              editor = false;
            })
          "
          >取消</ElButton
        ><ElButton data-guide-action="finance.category-save" type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      >
    </ElDialog>
    <BusinessDetailDialog
      :open="historyOpen"
      title="费用科目版本与删除历史"
      @close="historyOpen = false"
    >
      <BusinessHistory v-if="historyOpen && selected" record-kind="cost_nodes" :record-id="selected.id" :project-id="projectId" />
    </BusinessDetailDialog>
    <BusinessDetailDialog
      :open="!!costView"
      title="实际费用与历史"
      @close="costView = null"
      ><template v-if="costView"
        ><ElDescriptions :column="1" :label-width="150" border
          ><ElDescriptionsItem label="事项">{{
            costView.title
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="采用科目">{{
            costView.cost_node_name
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="正式状态">{{
            costView.deleted ? "已删除" : statusText[costView.status]
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="当前有效计入">{{
            money(
              costView.deleted || costView.status !== "active"
                ? 0
                : costView.amount_fen,
            )
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="当前版本金额">{{
            money(costView.amount_fen)
          }}</ElDescriptionsItem></ElDescriptions
        >
        <BusinessHistory record-kind="costs" :record-id="costView.entry_id" :project-id="projectId" />
      </template>
    </BusinessDetailDialog>
  </section>
</template>
<style scoped>
.tree-workspace {
  display: grid;
  grid-template-columns: minmax(210px, 28%) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
.tree-facts {
  min-width: 0;
}
.tree-path {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.tree-facts :deep(.el-descriptions__cell) {
  overflow-wrap: anywhere;
}
.tree-facts .toolbar .category-delete-action {
  margin-left: auto;
}
.tree-facts .subheading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-weight: 650;
  color: var(--ink);
  margin: 8px 0 10px;
}
.tree-path {margin:0 0 18px;font-size:12px;line-height:1.6}
.mobile-tree-switch, .mobile-back { display: none; }
@media (max-width: 1000px) {
  .mobile-tree-switch { display: flex; gap: 8px; margin: 12px 0; }
  .mobile-back { display: inline-flex; margin-bottom: 8px; }
  .tree-workspace.mobile-pane-list > .tree-facts { display: none; }
  .tree-workspace.mobile-pane-detail > :first-child { display: none; }
  .tree-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
