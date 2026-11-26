<template>
  <el-row :gutter="16" class="organization-directory">
    <el-col :span="8">
      <el-card shadow="never">
        <div class="flex flex-wrap gap-2">
          <el-input v-model="keyword" clearable placeholder="按组织名称查找" />
          <el-select v-model="treeStatus" aria-label="组织状态" placeholder="全部组织状态" clearable style="width:150px">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
          <el-checkbox data-guide-action="dictionaries.show-deleted" v-model="showDeleted">显示已删除</el-checkbox>
          <el-button v-if="canManage" type="primary" data-guide-action="dictionaries.organization-root" @click="form?.openForm('create')">新增组织</el-button>
          <el-button v-if="canManage" @click="openBatch(false)">批量新增顶级组织</el-button>
          <el-button v-if="canManage" @click="openBatch(true)">批量修订顶级组织</el-button>
        </div>
        <el-alert v-if="loadError" type="error" :title="loadError" :closable="false">
          <el-button type="primary" link @click="loadTree()">重新加载</el-button>
        </el-alert>
        <el-tree data-guide-action="dictionaries.organization" ref="tree" v-loading="loading" :data="treeData" node-key="id" default-expand-all
          highlight-current :expand-on-click-node="false" :filter-node-method="matches"
          empty-text="暂无组织" class="mt-3" @node-click="select">
          <template #default="{ data }">
            <span class="truncate" :title="data.name">{{ data.name }}</span>
            <el-tag v-if="data.deleted || data.status !== 'active'" size="small" type="info" class="ml-2">
              {{ data.deleted ? "已删除" : "已停用" }}
            </el-tag>
          </template>
        </el-tree>
      </el-card>
    </el-col>
    <el-col :span="16">
      <el-card shadow="never">
        <el-empty v-if="!selected" description="请选择组织查看档案" />
        <template v-else>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-semibold">{{ selected.name }}</h2>
            <div v-if="canManage && !selected.deleted" class="flex flex-wrap gap-2">
              <el-button v-if="selected.selectable" data-guide-action="dictionaries.organization-child" @click="addChild">新增下级</el-button>
              <el-button v-if="selected.selectable" @click="openBatch(false, selected.id)">批量新增下级</el-button>
              <el-button @click="openBatch(true, selected.parent_id || undefined)">批量修订同级</el-button>
              <el-button data-guide-action="dictionaries.organization-edit" @click="edit">修订资料</el-button>
              <el-button @click="openMove">调整上级</el-button>
              <el-button type="danger" plain :disabled="deleting" data-guide-action="dictionaries.organization-delete" @click="remove">删除组织</el-button>
            </div>
          </div>
          <el-descriptions border :column="2">
            <el-descriptions-item label="当前版本">V{{ selected.version_no }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ selected.deleted ? "已删除" : selected.status === "active" ? "启用" : "停用" }}</el-descriptions-item>
            <el-descriptions-item label="当前上级">{{ rows.find(row => row.id === selected?.parent_id)?.name || "顶级组织" }}</el-descriptions-item>
            <el-descriptions-item label="登记时间">{{ formatBeijingDateTime(selected.recorded_at) }}</el-descriptions-item>
          </el-descriptions>
          <el-alert v-if="detailError" :title="detailError" type="error" :closable="false">
            <el-button link type="primary" @click="loadDetail(selected.id)">重新读取</el-button>
          </el-alert>
          <el-skeleton v-if="detailLoading" :rows="4" animated />
          <el-tabs v-else-if="detail" v-model="detailTab" class="mt-4">
            <el-tab-pane name="versions"><template #label><span data-guide-action="dictionaries.organization-history">正式版本</span></template>
              <el-table :data="detail.versions" row-key="id" border>
                <el-table-column label="版本" width="79"><template #default="{ row }">V{{ row.version_no }}</template></el-table-column>
                <el-table-column label="当时组织路径" min-width="215">
                  <template #default="{ row }">{{ row.historical_path || row.name }}</template>
                </el-table-column>
                <el-table-column prop="actor_name" label="登记人" min-width="100" />
                <el-table-column label="登记时间" min-width="170">
                  <template #default="{ row }">{{ formatBeijingDateTime(row.recorded_at) }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="项目采用" name="projects">
              <el-table :data="detail.projects" row-key="id" border>
                <el-table-column label="项目" min-width="180">
                  <template #default="{ row }">
                    <el-button type="primary" link @click="router.push({ name: 'Projects', query: { project: row.id } })">{{ row.name }}</el-button>
                  </template>
                </el-table-column>
                <el-table-column prop="display_status" label="项目状态" min-width="105" />
                <el-table-column prop="adopted_name" label="项目正式归口" min-width="140" />
                <el-table-column prop="adopted_version" label="采用组织版本" width="120" />
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </el-card>
    </el-col>
  </el-row>

  <VersionedBatchWorksheet v-if="batchOpen" ref="batchEditor" :config="batchConfig" :revise="batchRevise"
    @close="batchOpen = false" @saved="batchOpen = false; loadTree(selectedId)">
    <el-text>上级组织 {{ rows.find(row => row.id === batchParent)?.name || "无（顶级组织）" }}</el-text>
  </VersionedBatchWorksheet>
  <CrudForm v-if="canManage" ref="form" :form-config="formConfig" @saved="loadTree(selectedId)" />
  <el-dialog v-model="moveOpen" title="调整组织上级" width="min(94vw, 680px)" append-to-body
    :show-close="!moving" :close-on-press-escape="!moving" :close-on-click-modal="false">
    <el-form novalidate label-position="top" :disabled="moving">
      <el-form-item label="目标上级">
        <el-select v-model="targetParent" clearable filterable placeholder="选择上级或留空设为顶级"
          @change="movePreview = undefined">
          <el-option v-for="item in availableParents" :key="item.value" :value="item.value" :label="item.label" />
        </el-select>
      </el-form-item>
    </el-form>
    <el-alert v-if="moveError" :title="moveError" type="error" :closable="false" class="mb-3" />
    <el-descriptions v-if="movePreview" border :column="1">
      <el-descriptions-item label="当前路径">{{ movePreview.before_path }}</el-descriptions-item>
      <el-descriptions-item label="目标路径">{{ movePreview.after_path }}</el-descriptions-item>
      <el-descriptions-item label="涉及下级组织">{{ movePreview.descendants }}</el-descriptions-item>
      <el-descriptions-item label="涉及在册项目">{{ movePreview.projects }}</el-descriptions-item>
    </el-descriptions>
    <template #footer>
      <el-button :disabled="moving" @click="moveOpen = false">取消</el-button>
      <el-button :loading="moving" @click="previewMove">核对迁移影响</el-button>
      <el-button type="primary" :disabled="moving || !movePreview" data-guide-action="dictionaries.organization-move-confirm" @click="commitMove">确认迁移</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type TreeInstance } from "element-plus";
import { useRouter } from "vue-router";
import { usePageOverlays } from "@/composables/usePageOverlays";
import type { VersionedBatchEntryConfig } from "./versioned-batch-entry";
import CrudForm from "@/components/Crud/CrudForm.vue";
import type { CrudFormConfig } from "@/components/Crud/types";
import { useUserStore } from "@/stores/user";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { deleteOrganization, moveOrganization, organizationTree, previewOrganizationMove, readOrganization, saveOrganization,
  type OrganizationDetail, type OrganizationForm, type OrganizationMovePreview, type OrganizationNode } from "@/api/business/organizations";

type TreeNode = OrganizationNode & { children: TreeNode[] };
const VersionedBatchWorksheet = defineAsyncComponent(() => import("./VersionedBatchWorksheet.vue"));
const batchOpen = ref(false), batchRevise = ref(false), batchParent = ref<string>();
const batchEditor = ref<InstanceType<typeof VersionedBatchWorksheet>>();
function openBatch(revise: boolean, parent?: string) {
  batchRevise.value = revise;
  batchParent.value = parent;
  batchOpen.value = true;
}
usePageOverlays([batchOpen], { mayLeave: () => batchOpen.value ? batchEditor.value?.mayLeave() ?? true : true });
const batchConfig = computed<VersionedBatchEntryConfig>(() => ({
  title: batchRevise.value ? "批量修订同级组织" : "批量新增组织",
  endpoint: "/api/catalog/organizations/entry-batch",
  columns: [
    { key: "name", title: "组织名称", width: 270, editable: true, required: true },
    { key: "reason", title: "变更说明", width: 310, editable: true },
  ],
  initial: () => ({}),
  async choices(keyword, page) {
    const choices = rows.value.filter(row => !row.deleted && (row.parent_id || undefined) === batchParent.value &&
      row.name.includes(keyword));
    return { total: choices.length, items: choices.slice((page - 1) * 20, page * 20).map(row => ({
      id: row.id, name: row.name, version: row.version_no,
      fields: { name: row.name, reason: "" },
    })) };
  },
  values(fields, record) {
    return { name: fields.name.trim(), reason: fields.reason || "",
      ...(record ? {} : { parent_unit_id: batchParent.value || null }) };
  },
}));
const router = useRouter();
const user = useUserStore();
const canManage = computed(() => user.userInfo.perms.includes("admin"));
const form = ref<InstanceType<typeof CrudForm>>();
const tree = ref<TreeInstance>();
const rows = ref<OrganizationNode[]>([]);
const selectedId = ref<string>();
const selected = computed(() => rows.value.find(row => row.id === selectedId.value));
const keyword = ref(""), showDeleted = ref(false);
const treeStatus = ref("");
const loading = ref(false), detailLoading = ref(false), deleting = ref(false);
const loadError = ref(""), detailError = ref("");
const detail = ref<OrganizationDetail>();
const detailTab = ref("versions");
const moveOpen = ref(false), moving = ref(false);
const targetParent = ref<string | null>(null);
const movePreview = ref<OrganizationMovePreview>();
const moveError = ref("");
let detailSequence = 0;
let savedId: string | undefined;

const treeData = computed(() => {
  const indexed = new Map<string, TreeNode>(rows.value.filter(row => showDeleted.value || !row.deleted)
    .map(row => [row.id, { ...row, children: [] }]));
  const roots: TreeNode[] = [];
  for (const row of indexed.values()) {
    const parent = row.parent_id ? indexed.get(row.parent_id) : undefined;
    if (parent) parent.children.push(row);
    else roots.push(row);
  }
  return roots;
});
const parentOptions = computed(() => rows.value.filter(row => row.selectable).map(row => ({ value: row.id, label: row.name })));
const availableParents = computed(() => {
  const parents = new Map(rows.value.map(row => [row.id, row.parent_id]));
  return parentOptions.value.filter(option => {
    let current: string | null | undefined = option.value;
    while (current) {
      if (current === selectedId.value) return false;
      current = parents.get(current);
    }
    return true;
  });
});

function matches(search: { keyword: string; status: string }, row: Record<string, unknown>) {
  return (!search.status || row.status === search.status) &&
    String(row.name ?? "").toLocaleLowerCase().includes(search.keyword.trim().toLocaleLowerCase());
}
function filterTree() {
  tree.value?.filter({ keyword: keyword.value, status: treeStatus.value });
}
async function loadTree(prefer?: string) {
  loading.value = true;
  loadError.value = "";
  try {
    rows.value = await organizationTree();
    const next = rows.value.find(row => row.id === (savedId ?? prefer) && (showDeleted.value || !row.deleted));
    savedId = undefined;
    selectedId.value = next?.id;
    await nextTick();
    filterTree();
    if (next) await select(next);
    else detail.value = undefined;
  } catch (cause) {
    loadError.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}
async function select(row: OrganizationNode) {
  if (selectedId.value !== row.id) detailTab.value = "versions";
  selectedId.value = row.id;
  tree.value?.setCurrentKey(row.id);
  await loadDetail(row.id);
}
async function loadDetail(id: string) {
  const sequence = ++detailSequence;
  detail.value = undefined;
  detailError.value = "";
  detailLoading.value = true;
  try {
    const result = await readOrganization(id);
    if (sequence === detailSequence) detail.value = result;
  } catch (cause) {
    if (sequence === detailSequence) detailError.value = (cause as Error).message;
  } finally {
    if (sequence === detailSequence) detailLoading.value = false;
  }
}
const formConfig: CrudFormConfig<OrganizationForm> = {
  rowKey: "id", dialog: { width: 630 },
  title: ({ mode }) => mode === "create" ? "新增组织" : "修订组织资料",
  fields: [
    { prop: "version_no", label: "正式版本", type: "input-number", hidden: true },
    { prop: "name", label: "组织名称", type: "input", required: true },
    { prop: "parent_id", label: "上级组织", type: "select", options: parentOptions, attrs: { clearable: true, filterable: true },
      visible: ({ mode }) => mode === "create" },
    { prop: "status", label: "状态", type: "radio", initialValue: "active",
      options: [{ label: "启用", value: "active" }, { label: "停用", value: "inactive" }] },
    { prop: "reason", label: "修订说明", type: "input" },
  ],
  async submitForm(data, { id }) {
    savedId = (await saveOrganization(data, id ? String(id) : undefined)).id;
  },
};
function addChild() {
  if (form.value?.openForm("create")) form.value.setFormData({ parent_id: selectedId.value });
}
function edit() {
  if (selected.value && form.value?.openForm("edit", { ...selected.value })) form.value.setFormData({ ...selected.value });
}
function openMove() {
  targetParent.value = selected.value?.parent_id ?? null;
  movePreview.value = undefined;
  moveError.value = "";
  moveOpen.value = true;
}
async function previewMove() {
  if (!selected.value || moving.value) return;
  moving.value = true;
  moveError.value = "";
  movePreview.value = undefined;
  try { movePreview.value = await previewOrganizationMove(selected.value.id, targetParent.value); }
  catch (cause) { moveError.value = (cause as Error).message; }
  finally { moving.value = false; }
}
async function commitMove() {
  if (!selected.value || !movePreview.value || moving.value) return;
  moving.value = true;
  moveError.value = "";
  try {
    await moveOrganization(selected.value.id, movePreview.value);
    moveOpen.value = false;
    ElMessage.success("组织迁移已登记");
    await loadTree(selectedId.value);
  } catch (cause) {
    movePreview.value = undefined;
    moveError.value = (cause as Error).message;
  } finally { moving.value = false; }
}
async function remove() {
  const row = selected.value;
  if (!row || deleting.value) return;
  deleting.value = true;
  try {
    const { references } = await readOrganization(row.id);
    await ElMessageBox.confirm(
      "直属下级 " + references.children + " 个，历史项目引用 " + references.historical_projects + " 条。确定删除该组织？",
      "核对组织删除影响", { type: "warning", confirmButtonText: "确认删除" },
    );
    await deleteOrganization(row, references);
    ElMessage.success("组织已删除，历史版本已保留");
    await loadTree(selectedId.value);
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") ElMessage.error((cause as Error).message);
  } finally { deleting.value = false; }
}
watch([keyword, treeStatus], filterTree);
watch(showDeleted, async value => {
  if (!value && selected.value?.deleted) selectedId.value = undefined;
  await nextTick();
  filterTree();
});
onMounted(() => loadTree());
</script>
