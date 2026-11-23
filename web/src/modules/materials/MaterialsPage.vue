<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import type {
  MaterialRecord,
  MaterialDetail,
  DefinitionStatus,
} from "../../../../server/shared/types/master-data";
import type {
  FieldErrors,
  Page,
} from "../../../../server/shared/types/contracts";
import type { CatalogField } from "../../../../server/shared/types/catalog";
import { api, statusText } from "../../shared/api/client";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useAccess } from "../../shared/composables/use-access";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";
import TabulatorGrid, { type GridColumn } from "../../shared/ui/TabulatorGrid.vue";
import BusinessDraftGrid, { type DraftGridColumn, type DraftGridRow } from "../../shared/ui/BusinessDraftGrid.vue";
import type { FacetPage, FacetValue } from "../../shared/ui/ExcelColumnFilter.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import FieldControl from "../../shared/ui/FieldControl.vue";
interface MaterialForm {
  name: string;
  unit_id: string | null;
  model: string;
  specification: string;
  note: string;
  status: DefinitionStatus;
}
const fields: (CatalogField & { key: keyof MaterialForm })[] = [
  { key: "name", label: "物资名称", type: "text", required: true },
  {
    key: "unit_id",
    label: "计量单位",
    type: "ref",
    reference: "units",
    required: true,
  },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: ["active", "inactive"],
    required: true,
  },
  { key: "model", label: "型号", type: "text" },
  { key: "specification", label: "规格", type: "text" },
  { key: "note", label: "备注", type: "text" },
];
const columns: GridColumn[] = fields.map(field => ({
  key: field.key,
  label: field.label,
  minWidth: field.key === "name" ? 190 : 130,
}));
const grid = ref<{ openSettings: () => void } | null>(null);
const bulkEditing = ref(false);
const bulkSaving = ref(false);
const bulkOriginal = ref<MaterialRecord[]>([]);
const bulkRows = ref<DraftGridRow[]>([]);
const bulkColumns: DraftGridColumn[] = [
  { field: "code", title: "物资编号", minWidth: 116 },
  { field: "name", title: "物资名称", minWidth: 165, editable: true },
  { field: "model", title: "型号", minWidth: 130, editable: true },
  { field: "specification", title: "规格", minWidth: 140, editable: true },
  { field: "note", title: "备注", minWidth: 170, editable: true },
  { field: "unit_id_label", title: "计量单位", minWidth: 100 },
  { field: "status_text", title: "状态", minWidth: 90 },
];
const editableFields = ["name","model","specification","note"] as const;
const bulkChanges = computed(() => bulkOriginal.value.flatMap(original => {
  const draft = bulkRows.value.find(row => row.id===original.id);
  if (!draft) return [];
  const changes = Object.fromEntries(editableFields.filter(key =>
    String(draft[key]??"") !== String(original[key]??""))
    .map(key => [key,String(draft[key]??"")]));
  return Object.keys(changes).length
    ? [{id:original.id,expected_version:original.version_no,changes}] : [];
}));
function startBulkEdit() {
  bulkOriginal.value = rows.value.map(row=>({...row}));
  bulkRows.value = rows.value.map(row=>({
    id:row.id,code:row.code,name:row.name,model:row.model,
    specification:row.specification,note:row.note,
    unit_id_label:row.unit_id_label,status_text:statusText[row.status],
  }));
  bulkEditing.value=true;
}
function updateBulkCell(id:string, field:string, value:string) {
  const draft = bulkRows.value.find(row=>row.id===id);
  if (draft && editableFields.some(item=>item===field)) draft[field]=value;
}
async function discardBulkEdit() {
  if (bulkChanges.value.length) {
    try {
      await ElMessageBox.confirm(
        "当前批量编辑的修改尚未保存，确定放弃全部修改吗？",
        "放弃批量修改", {type:"warning"},
      );
    } catch { return; }
  }
  bulkEditing.value=false;
  bulkOriginal.value=[];
  bulkRows.value=[];
}
async function saveBulkEdit() {
  const changes=bulkChanges.value;
  if (!changes.length) {
    ElMessage.info("没有需要保存的修改");
    return;
  }
  if (changes.some(item=>item.changes.name!==undefined && !String(item.changes.name).trim())) {
    ElMessage.error("物资名称不能为空，请修正后再保存");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `本次将修改 ${changes.length} 条物资，并分别产生新的正式版本。任一条验证失败将整批回滚，确定保存吗？`,
      "确认批量保存", {type:"warning"},
    );
  } catch { return; }
  bulkSaving.value=true;
  try {
    const result=await api<{count:number}>("/catalog/materials/bulk","POST",{rows:changes});
    bulkEditing.value=false;
    bulkOriginal.value=[];
    bulkRows.value=[];
    await load();
    ElMessage.success(`已保存 ${result.count} 条物资的正式版本`);
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    bulkSaving.value=false;
  }
}
type GridFilters = Record<string, FacetValue[]>;
const gridState = ref("{}");
const gridFilters = computed<GridFilters>(() => {
  try { return JSON.parse(gridState.value) as GridFilters; }
  catch { return {}; }
});
const can = useAccess(),
  descriptionColumns = useDescriptionColumns();
const rows = ref<MaterialRecord[]>([]),
  total = ref(0),
  query = ref(""),
  page = ref(1),
  deleted = ref(false),
  sort = ref(""),
  direction = ref(""),
  loading = ref(false),
  error = ref("");
const detailState = shallowRef<MaterialDetail | null>(null),
  editor = ref(false),
  editing = ref<MaterialRecord | null>(null),
  saving = ref(false),
  formRef = ref<FormInstance>(),
  fieldErrors = ref<FieldErrors>({});
const detail = computed(() => detailState.value?.item || null),
  historyOpen = ref(false);
const form = ref<MaterialForm>({
  name: "",
  unit_id: null,
  model: "",
  specification: "",
  note: "",
  status: "active",
});
const guard = useDialogDraftGuard(() => form.value);
let sequence = 0;
async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  const parameters = new URLSearchParams({
    page: String(page.value),
    q: query.value,
    deleted: String(deleted.value),
    sort: sort.value || "created_at",
    direction: direction.value || "desc",
    filters: "{}",
    grid_filters: gridState.value,
  });
  try {
    const result = await api<Page<MaterialRecord>>(
      `/catalog/materials?${parameters}`,
    );
    if (current === sequence) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
async function filterValues(field: string, term: string, offset: number): Promise<FacetPage> {
  const params = new URLSearchParams({
    column: field,
    term,
    offset: String(offset),
    q: query.value,
    deleted: String(deleted.value),
    filters: "{}",
    grid_filters: gridState.value,
  });
  return api<FacetPage>("/catalog/materials/filter-values?" + params);
}
function applyGridFilters(value: GridFilters) {
  gridState.value = JSON.stringify(value);
  page.value = 1;
  void load();
}
function applyGridSort(value: { key: string; direction: "asc" | "desc" | "" }) {
  sort.value = value.key;
  direction.value = value.direction;
  page.value = 1;
  void load();
}
async function fetchDetail(id: string): Promise<MaterialDetail> {
  return api<MaterialDetail>(`/catalog/materials/${id}?deleted=true&history=true`);
}
const detailDialog = useEntityDialog(detailState, fetchDetail, () => {
  historyOpen.value = false;
  editor.value = false;
});
async function refresh() {
  await load();
  if (detail.value) {
    const id = detail.value.id;
    const value = await fetchDetail(id);
    if (detail.value?.id === id) detailState.value = value;
  }
}
function edit(row?: MaterialRecord) {
  editing.value = row || null;
  fieldErrors.value = {};
  form.value = {
    name: row?.name || "",
    unit_id: row?.unit_id || null,
    model: row?.model || "",
    specification: row?.specification || "",
    note: row?.note || "",
    status: row?.status || "active",
  };
  editor.value = true;
  guard.capture();
}
function close(done?: () => void) {
  void guard.confirmClose(() => {
    editor.value = false;
    done?.();
  });
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    await api(
      `/catalog/materials` + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      { ...form.value, expected_version: editing.value?.version_no || 1 },
    );
    await refresh();
    editor.value = false;
    ElMessage.success("正式版本已保存");
  } catch (failure) {
    const problem = failure as Error & { fields?: FieldErrors };
    fieldErrors.value = problem.fields || {};
    ElMessage.error(problem.message);
  } finally {
    saving.value = false;
  }
}
async function remove(row: MaterialRecord) {
  try {
    const impact = await api<{ references: number; expected_version: number }>(
      `/catalog/materials/${row.id}/deletion-impact`,
    );
    await ElMessageBox.confirm(
      `当前有${impact.references}处正式关联。删除保留原物资版本和这些关联，并停止新增选用。`,
      "确认删除",
      { type: "warning" },
    );
    await api(`/catalog/materials/${row.id}`, "DELETE", {
      expected_version: impact.expected_version,
      expected_references: impact.references,
    });
    await refresh();
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
function fieldError(key: string) {
  const value = fieldErrors.value[key];
  return Array.isArray(value) ? value.join("、") : value || "";
}
function clear() {
  query.value = "";
  gridState.value = "{}";
  page.value = 1;
  void load();
}
useListRoute({ q: query, page, deleted, sort, direction, grid: gridState }, load);
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>物资管理</h1>
      <p>物资名称、型号规格与正式版本</p>
    </div>

  </div>
  <ElAlert v-if="error" :title="error" type="error" :closable="false"
    ><ElButton @click="load">重试</ElButton></ElAlert
  >
  <div class="panel">

    <div v-if="bulkEditing" class="unified-list-tools">
      <div class="toolbar">
        <strong>批量编辑模式 · 当前页 {{ bulkOriginal.length }} 条</strong>
        <span class="muted">只允许修改名称、型号、规格、备注；其他字段及跨页数据均受保护</span>
      </div>
      <div class="toolbar page-heading-actions">
        <span class="muted">待保存 {{ bulkChanges.length }} 条</span>
        <ElButton @click="discardBulkEdit">取消编辑</ElButton>
        <ElButton type="primary" data-guide-action="materials.batch-save"
          :loading="bulkSaving" :disabled="!bulkChanges.length"
          @click="saveBulkEdit">保存批量修改</ElButton>
      </div>
    </div>
    <div v-else class="unified-list-tools">
      <div class="toolbar">
        <ElInput v-model="query" clearable placeholder="搜索物资名称、型号或规格"
          @change="page = 1;load()" />
        <ElCheckbox data-guide-action="materials.show-deleted" v-model="deleted"
          @change="page = 1;load()">包含已删除</ElCheckbox>
        <ElButton v-if="Object.keys(gridFilters).length || query" link type="primary" @click="clear">清除检索与列筛选</ElButton>
      </div>
      <div class="toolbar page-heading-actions">
        <ElButton :loading="loading" @click="load">刷新</ElButton>
        <ElButton class="business-column-setting-trigger" @click="grid?.openSettings()">列设置</ElButton>
        <ElButton v-if="can('admin') && !deleted && rows.length"
          data-guide-action="materials.batch-edit" @click="startBulkEdit">批量编辑</ElButton>
        <ElButton data-guide-action="materials.create" type="primary" v-if="can('admin')" @click="edit()">新增物资</ElButton>
      </div>
    </div>
    <BusinessDraftGrid v-if="bulkEditing" mode="edit" grid-key="catalog:materials-batch"
      :rows="bulkRows" :columns="bulkColumns" @change="updateBulkCell"/>
    <TabulatorGrid v-else ref="grid" detail-column="name" :rows="rows" :loading="loading"
      :columns="columns" table-key="catalog:materials" :filters="gridFilters"
      :sort-key="sort" :sort-direction="direction === 'asc' ? 'asc' : direction === 'desc' ? 'desc' : ''"
      :get-values="filterValues" @open-detail="detailDialog.open($event.id)"
      @filter-change="applyGridFilters" @sort-change="applyGridSort" />
    <ElPagination
      v-model:current-page="page"
      :disabled="bulkEditing"
      :page-size="30"
      :total="total"
      layout="prev,pager,next,total"
      @current-change="load"
    />
  </div>
  <BusinessDetailDialog
    :open="detailDialog.isOpen.value"
    title="物资详情"
    :loading="detailDialog.loading.value"
    :error="detailDialog.error.value"
    @close="detailDialog.close"
    @retry="detailDialog.reload"
    ><template v-if="detail"
      ><div class="detail-header">
        <h1>{{ detail.label }}</h1>
        <ElTag>{{
          detail.deleted ? "已删除" : statusText[detail.status]
        }}</ElTag>
      </div>
      <div class="toolbar">
        <ElButton data-guide-action="materials.edit"
          v-if="can('admin') && !detail.deleted"
          @click="edit(detail)"
          >编辑</ElButton
        ><ElButton data-guide-action="materials.disable"
          type="danger"
          v-if="can('admin') && !detail.deleted"
          @click="remove(detail)"
          >删除</ElButton
        >
      </div>
      <ElDescriptions :column="descriptionColumns" border
        ><ElDescriptionsItem label="名称">{{ detail.name }}</ElDescriptionsItem
        ><ElDescriptionsItem label="计量单位">{{
          detail.unit_id_label
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="型号">{{
          detail.model || "—"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="规格">{{
          detail.specification || "—"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="备注">{{
          detail.note || "—"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="正式版本"
          >第{{ detail.version_no }}版</ElDescriptionsItem
        ></ElDescriptions
      >
      <ElButton data-guide-action="materials.history" @click="historyOpen = !historyOpen">历史记录</ElButton>
      <BusinessHistory reveal v-if="historyOpen" record-kind="materials" :record-id="detail.id" /></template
  ></BusinessDetailDialog>
  <ElDialog
    v-model="editor"
    append-to-body
    :title="(editing ? '编辑' : '新增') + '物资'"
    width="800px"
    :close-on-click-modal="false"
    :before-close="close"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><div class="form-grid">
        <ElFormItem
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :prop="field.key"
          :error="fieldError(field.key)"
          :rules="
            field.required
              ? [{ required: true, message: '请填写' + field.label }]
              : []
          "
          ><span v-if="editing && field.key === 'unit_id'"
            >{{ editing.unit_id_label }}。物资沿用原计量单位。</span
          ><FieldControl v-else v-model="form[field.key]" :field="field"
        /></ElFormItem></div></ElForm
    ><template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="materials.save" type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    ></ElDialog
  >
</template>
