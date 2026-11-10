<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import type {
  OrganizationNode,
  OrganizationDetail,
  OrganizationMovePreview,
} from "../../../../../server/shared/types/trees";
import { useEntityDialog } from "../../../shared/composables/use-entity-dialog";
import { api, money, statusText } from "../../../shared/api/client";
import { useAccess } from "../../../shared/composables/use-access";
import { useDialogDraftGuard } from "../../../shared/forms/use-dialog-draft";
import { treePath, descendantIds } from "../../../shared/utils/tree";
import BusinessTree from "../../../shared/ui/BusinessTree.vue";
import BusinessTreeSelect from "../../../shared/ui/BusinessTreeSelect.vue";
import BusinessTable from "../../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../../shared/ui/BusinessDetailDialog.vue";
const can = useAccess();
const nodes = ref<OrganizationNode[]>([]),
  selectedId = ref<string | null>(
    sessionStorage.getItem("sd-organization-node"),
  );
const selected = computed(() =>
  nodes.value.find((node) => node.id === selectedId.value),
);
const mobilePane = ref<"list" | "detail">("list");
const detail = ref<OrganizationDetail | null>(null),
  loading = ref(false),
  error = ref(""),
  includeDeleted = ref(false);
const path = computed(() =>
  selectedId.value
    ? treePath(nodes.value, selectedId.value)
        .map((node) => node.name)
        .join(" / ")
    : "",
);
const children = computed(() =>
  nodes.value.filter((node) => node.parent_id === selectedId.value),
);
const visible = computed(() => {
  if (includeDeleted.value) return nodes.value;
  const ids = new Set<string>();
  for (const node of nodes.value)
    if (!node.deleted)
      for (const parent of treePath(nodes.value, node.id)) ids.add(parent.id);
  return nodes.value.filter((node) => ids.has(node.id));
});
let sequence = 0;
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
    const value = await api<OrganizationDetail>("/organizations/" + id);
    if (current === sequence) detail.value = value;
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  }
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    nodes.value = await api<OrganizationNode[]>("/organizations");
    if (!nodes.value.some((node) => node.id === selectedId.value))
      selectedId.value = visible.value[0]?.id || null;
    if (selected.value?.deleted) includeDeleted.value = true;
    await loadDetail();
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(selectedId, (value) => {
  if (value) mobilePane.value = "detail";
  if (value) sessionStorage.setItem("sd-organization-node", value);
  void loadDetail();
});
onMounted(load);
const editor = ref(false),
  editing = ref<OrganizationNode | null>(null),
  moving = ref(false),
  targetParent = ref<string | null>(null);
const preview = ref<OrganizationMovePreview | null>(null),
  previewError = ref(""),
  saving = ref(false),
  formRef = ref<FormInstance>();
const form = ref({
  name: "",
  status: "active",
  parent_unit_id: null as string | null,
});
const guard = useDialogDraftGuard(() => form.value);
function edit(node?: OrganizationNode, parent?: string) {
  editing.value = node || null;
  form.value = {
    name: node?.name || "",
    status: node?.status || "active",
    parent_unit_id: node?.parent_id || parent || null,
  };
  editor.value = true;
  guard.capture();
}
const parentChoices = computed(() => {
  const blocked = editing.value
    ? descendantIds(nodes.value, editing.value.id)
    : new Set<string>();
  if (editing.value) blocked.add(editing.value.id);
  return nodes.value.map((node) => ({
    ...node,
    disabled: !node.selectable || blocked.has(node.id),
    disabled_reason: blocked.has(node.id)
      ? "不能选择自身或下级单位"
      : node.disabled_reason,
  }));
});
const moveChoices = computed(() => {
  const blocked = selectedId.value
    ? descendantIds(nodes.value, selectedId.value)
    : new Set<string>();
  if (selectedId.value) blocked.add(selectedId.value);
  return nodes.value.map((node) => ({
    ...node,
    disabled: !node.selectable || blocked.has(node.id),
    disabled_reason: blocked.has(node.id)
      ? "不能选择自身或下级单位"
      : node.disabled_reason,
  }));
});
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate())) return;
    const result = await api<{ id: string }>(
      "/catalog/organizations" + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      {
        ...form.value,
        ...(editing.value
          ? { expected_version: editing.value.version_no }
          : {}),
      },
    );
    selectedId.value = result.id;
    editor.value = false;
    await load();
    ElMessage.success("单位已保存");
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  } finally {
    saving.value = false;
  }
}
function openMove() {
  targetParent.value = selected.value?.parent_id || null;
  preview.value = null;
  previewError.value = "";
  moving.value = true;
}
watch(targetParent, () => {
  preview.value = null;
  previewError.value = "";
});
async function previewMove() {
  previewError.value = "";
  try {
    preview.value = await api<OrganizationMovePreview>(
      `/organizations/${selectedId.value}/move-preview?parent_id=${encodeURIComponent(targetParent.value || "")}`,
    );
  } catch (failure) {
    previewError.value = (failure as Error).message;
  }
}
async function move() {
  if (!preview.value || saving.value) return;
  saving.value = true;
  try {
    await api(`/organizations/${selectedId.value}/parent`, "POST", {
      ...preview.value,
      confirm_move: true,
    });
    moving.value = false;
    await load();
    ElMessage.success("组织上级已修订，历史版本已保留");
  } catch (failure) {
    ElMessage.error((failure as Error).message);
    preview.value = null;
  } finally {
    saving.value = false;
  }
}
async function remove() {
  if (!selected.value) return;
  const node = selected.value;
  try {
    const facts = await api<OrganizationDetail>("/organizations/" + node.id);
    await ElMessageBox.confirm(
      `该单位有${facts.references.children}个直属下级、${facts.references.projects}个当前关联项目、${facts.references.historical_projects}条历史项目引用。删除保留这些关联及正式历史。`,
      "删除归口单位",
      { type: "warning" },
    );
    await api("/catalog/organizations/" + node.id, "DELETE", {
      expected_version: node.version_no,
      expected_children: facts.references.children,
      expected_references: facts.references.historical_projects,
    });
    includeDeleted.value = true;
    await load();
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
const historyOpen = ref(false);
interface LinkedProject {
  name: string;
  code: string;
  status: string;
  managing_unit_name: string | null;
  profile_version: number;
  approval: { approved_budget_fen: number } | null;
}
const linkedProject = ref<LinkedProject | null>(null);
const projectDialog = useEntityDialog(
  linkedProject,
  (id) => api<LinkedProject>("/projects/" + id),
  () => {},
);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">基础配置</div>
      <h1>基础数据</h1>
      <p>归口单位与正式组织关系</p>
    </div>
    <div class="page-heading-actions">
      <ElButton type="primary" :disabled="!can('admin')" @click="edit()"
        >新增归口单位</ElButton
      >
    </div>
  </div>
  <slot name="tabs" />
  <ElAlert v-if="error" :title="error" type="error" :closable="false"
    ><ElButton @click="load">重试</ElButton></ElAlert
  >
  <div class="panel organization-workspace">
    <div class="toolbar">
      <ElCheckbox v-model="includeDeleted">包含已删除单位</ElCheckbox
      ><ElButton text @click="load">刷新组织</ElButton>
    </div>
    <div class="mobile-tree-switch" role="group" aria-label="单位视图切换">
      <ElButton :type="mobilePane === 'list' ? 'primary' : 'default'" @click="mobilePane = 'list'">单位列表</ElButton>
      <ElButton :type="mobilePane === 'detail' ? 'primary' : 'default'" :disabled="!selected" @click="mobilePane = 'detail'">单位详情</ElButton>
    </div>
    <div class="tree-workspace" :class="'mobile-pane-' + mobilePane">
      <BusinessTree
        v-model="selectedId"
        :nodes="visible"
        label="归口单位"
        :loading="loading"
        ><template #empty
          ><ElButton :disabled="!can('admin')" @click="edit()"
            >新增根单位</ElButton
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
          <ElButton
            :disabled="!can('admin') || !selected.selectable"
            @click="edit(undefined, selected.id)"
            >新增直属下级</ElButton
          ><ElButton
            :disabled="!can('admin') || selected.deleted"
            @click="edit(selected)"
            >编辑资料</ElButton
          ><ElButton
            :disabled="!can('admin') || selected.deleted"
            @click="openMove"
            >调整上级</ElButton
          ><ElButton @click="historyOpen = true">组织变更历史</ElButton
          ><ElButton
            type="danger"
            :disabled="!can('admin') || selected.deleted"
            @click="remove"
            >删除单位</ElButton
          >
        </div>
        <ElDescriptions :column="1" :label-width="150" border
          ><ElDescriptionsItem label="直属上级">{{
            nodes.find((node) => node.id === selected?.parent_id)?.name ||
            "根单位"
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="直属下级">{{
            `${children.length}个`
          }}</ElDescriptionsItem
          ><ElDescriptionsItem v-if="children.length" label="下级单位">
            <ElButton v-for="child in children.slice(0, 6)" :key="child.id" text @click="selectedId = child.id">{{ child.name }}</ElButton>
            <span v-if="children.length > 6">等{{ children.length }}个单位</span>
          </ElDescriptionsItem><ElDescriptionsItem label="正式版本"
            >第{{ selected.version_no }}版</ElDescriptionsItem
          ><ElDescriptionsItem label="版本变更时间">{{
            selected.recorded_at ? new Date(selected.recorded_at).toLocaleString("zh-CN", { hour12: false }) : "—"
          }}</ElDescriptionsItem></ElDescriptions
        >
        <h3>当前关联子项目</h3>
        <BusinessTable
          client-side
          table-key="organization:projects"
          :rows="detail?.projects || []"
          :columns="[
            { key: 'name', label: '子项目' },
            { key: 'status', label: '阶段' },
            { key: 'adopted_name', label: '采用单位名称' },
            { key: 'adopted_version', label: '采用正式版本' },
          ]"
          ><template #cell="{ row, column, value }"
            ><span>{{
              column.key === "status" ? statusText[row.status] : value
            }}</span></template
          ><template #actions="{ row }">
            <ElButton size="small" @click="projectDialog.open(String(row.id))"
              >查看项目</ElButton
            >
          </template></BusinessTable
        >
      </section>
      <ElEmpty v-else description="选择单位查看组织资料" :image-size="70" />
    </div>
  </div>
  <ElDialog
    v-model="editor"
    append-to-body
    title="归口单位资料"
    width="620px"
    :close-on-click-modal="false"
    :before-close="
      (done) => {
        void guard.confirmClose(done);
      }
    "
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><ElFormItem
        label="名称"
        prop="name"
        :rules="[{ required: true, message: '请填写单位名称' }]"
        ><ElInput v-model="form.name" /></ElFormItem
      ><ElFormItem label="上级单位"
        ><span v-if="editing"
          >{{
            editing.parent_id
              ? treePath(nodes, editing.parent_id)
                  .map((node) => node.name)
                  .join(" / ")
              : "根单位"
          }}。调整组织关系请使用“调整上级”。</span
        ><BusinessTreeSelect
          v-else
          v-model="form.parent_unit_id"
          :nodes="parentChoices"
          placeholder="选择上级，留空建立根单位" /></ElFormItem
      ><ElFormItem label="状态"
        ><ElSelect v-model="form.status"
          ><ElOption label="启用" value="active" /><ElOption
            label="停用"
            value="inactive" /></ElSelect></ElFormItem></ElForm
    ><template #footer
      ><ElButton
        @click="
          guard.confirmClose(() => {
            editor = false;
          })
        "
        >取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog
    v-model="moving"
    append-to-body
    title="调整组织上级"
    width="680px"
    :close-on-click-modal="false"
    ><ElForm label-position="top" novalidate
      ><ElFormItem label="目标上级单位"
        ><BusinessTreeSelect
          v-model="targetParent"
          :nodes="moveChoices"
          placeholder="选择目标上级，清空表示根单位" /></ElFormItem></ElForm
    ><ElAlert
      v-if="previewError"
      :title="previewError"
      type="error"
      :closable="false"
    /><ElDescriptions v-if="preview" :column="1" border
      ><ElDescriptionsItem label="调整前路径">{{
        preview.before_path
      }}</ElDescriptionsItem
      ><ElDescriptionsItem label="调整后路径">{{
        preview.after_path
      }}</ElDescriptionsItem
      ><ElDescriptionsItem label="受影响下级数量">{{
        preview.descendants
      }}</ElDescriptionsItem
      ><ElDescriptionsItem label="当前关联项目"
        >{{
          preview.projects
        }}。已采用的正式单位版本继续保留。</ElDescriptionsItem
      ></ElDescriptions
    ><template #footer
      ><ElButton @click="moving = false">取消</ElButton
      ><ElButton @click="previewMove">预览调整</ElButton
      ><ElButton
        type="primary"
        :disabled="!preview"
        :loading="saving"
        @click="move"
        >确认调整</ElButton
      ></template
    ></ElDialog
  >
  <BusinessDetailDialog
    :open="projectDialog.isOpen.value"
    :loading="projectDialog.loading.value"
    :error="projectDialog.error.value"
    title="关联子项目资料"
    @close="projectDialog.close"
    @retry="projectDialog.reload"
  >
    <ElDescriptions v-if="linkedProject" :column="1" :label-width="150" border>
      <ElDescriptionsItem label="子项目">{{
        linkedProject.name
      }}</ElDescriptionsItem>
      <ElDescriptionsItem label="阶段">{{
        statusText[linkedProject.status]
      }}</ElDescriptionsItem>
      <ElDescriptionsItem label="采用单位名称">{{
        linkedProject.managing_unit_name || "未指定"
      }}</ElDescriptionsItem>
      <ElDescriptionsItem label="档案版本"
        >第{{ linkedProject.profile_version }}版</ElDescriptionsItem
      >
      <ElDescriptionsItem label="批准预算">{{
        !linkedProject.approval
          ? "未批准"
          : "¥" + money(linkedProject.approval.approved_budget_fen)
      }}</ElDescriptionsItem>
    </ElDescriptions>
  </BusinessDetailDialog>
  <BusinessDetailDialog
    :open="historyOpen"
    title="组织正式版本与上级历史"
    @close="historyOpen = false"
    ><BusinessTable
      client-side
      table-key="organization:versions"
      :rows="detail?.versions || []"
      :columns="[
        { key: 'version_no', label: '正式版本' },
        { key: 'name', label: '采用名称' },
        { key: 'parent_name', label: '当时上级名称' },
        { key: 'historical_path', label: '该正式版本的组织路径' },
        { key: 'status', label: '状态' },
        { key: 'actor_name', label: '操作人' },
        { key: 'recorded_at', label: '变更时间' },
      ]"
      ><template #cell="{ row, column, value }"
        ><span>{{
          column.key === "status"
            ? statusText[row.status]
            : column.key === "parent_name"
              ? row.parent_unit_id
                ? row.parent_name || "历史上级（定义待核对）"
                : "根单位"
              : value
        }}</span></template
      ></BusinessTable
    ><BusinessTable
      client-side
      table-key="organization:audit"
      :rows="detail?.audits || []"
      :columns="[
        { key: 'action', label: '审计操作' },
        { key: 'actor_name', label: '操作人' },
        { key: 'created_at', label: '操作时间' },
      ]"
      ><template #cell="{ row, column, value }"
        ><span>{{
          column.key === "action"
            ? statusText[row.action] || row.action
            : value
        }}</span></template
      ></BusinessTable
    ></BusinessDetailDialog
  >
</template>
<style scoped>
.tree-workspace {
  display: grid;
  grid-template-columns: minmax(230px, 28%) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.tree-facts {
  min-width: 0;
}
.tree-path {
  color: var(--muted);
  overflow-wrap: anywhere;
}
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
