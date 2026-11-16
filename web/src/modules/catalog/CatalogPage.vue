<script setup lang="ts">
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useRoute, useRouter } from "vue-router";
import { useListRoute } from "../../shared/composables/use-list-route";
const route = useRoute(), router = useRouter();
import RowActions from "../../shared/ui/RowActions.vue";
import { factText } from "../../shared/utils/display";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, watch, onMounted, computed, nextTick } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { api, type Row, statusText, money, quantity } from "../../shared/api/client";
import type { CatalogFormDefinition, CatalogField } from "../../../../server/shared/types/catalog";
interface CatalogRow extends Row {
  id:string;
  deleted?:boolean;
  status?:string;
  reference_names?:Record<string,string>;
}
const props = defineProps<{ kinds: string[]; title: string }>();
const definitions = ref<Record<string,CatalogFormDefinition>>({}),
  rows = ref<CatalogRow[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref(""),
  columnFilters = ref<Record<string, string>>({}),
  deleted = ref(false),
  dialog = ref(false),
  loading = ref(false),
  saving = ref(false),
  editing = ref<CatalogRow | null>(null),
  form = ref<Row>({}),
  errors = ref<Record<string,string>>({}),
  formRef = ref(),
  detail = ref<CatalogRow | null>(null),
  businessLabels = ref<Record<string,string>>({}),
  history = ref<unknown>(null);
const kind = computed({
  get: () => String(route.params.kind || props.kinds[0]),
  set: value => { void router.push({ name: route.name!, params: { kind: value }, query: {} }); },
});
const catalogPermission = computed(() =>
  ["frameworks", "agreements"].includes(kind.value) ? "write" : "admin",
);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence,
    requestedKind = kind.value;
  loading.value = true;
  try {
    const result = await api<{ items: CatalogRow[]; total: number }>(
      `/catalog/${requestedKind}?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${deleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value || "desc"}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
    );
    if (sequence !== loadSequence || requestedKind !== kind.value) return;
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function edit(row?: CatalogRow, historical = false) {
  editing.value = row || null;
  errors.value = {};
  form.value = {
    historical_update: historical,
  };
  for (const f of fields()) {
    const value =
      row?.[f.key] ??
      f.default ??
      (f.type === "text" && !f.nullable ? "" : null);
    form.value[f.key] =
      f.type === "json"
        ? typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2)
        : value;
  }
  dialog.value = true;
  draftGuard.capture();
}
function fields() {
  const c = definitions.value[kind.value];
  return c
    ? [...c.rootFields, ...c.fields].filter(
        (f) =>
          !f.systemManaged,
      )
    : [];
}
const tableColumns = computed<TableColumn[]>(() => {
  const c = definitions.value[kind.value];
  if (!c) return [];
  return [...c.rootFields, ...c.fields]
    .filter((f: CatalogField) => !f.systemManaged && f.type !== "json")
    .map((f: CatalogField) => ({ key: f.key, label: f.label, minWidth: ["name", "title"].includes(f.key) ? 190 : 130 }));
});
function tableCell(row: CatalogRow, column: TableColumn) {
  const key = column.key, value = row[key];
  if (value === null || value === undefined || value === "") return "—";
  const displayed = formatVisibleDateTime(value, key);
  if (displayed !== value) return displayed;
  if (typeof value === "boolean") return value ? "是" : "否";
  const f = [...(definitions.value[kind.value]?.rootFields || []), ...(definitions.value[kind.value]?.fields || [])].find((f: CatalogField) => f.key === key);
  if (f?.type === "boolean") return value ? "是" : "否";
  if (f?.type === "select")
    return statusText[String(value)] || value;
  if (f?.type === "ref") return value ? row[key + "_label"] || "历史关联记录" : "—";
  if (f?.type === "money") return "¥" + money(Number(value));
  if (f?.type === "quantity") return quantity(Number(value));
  return value;
}
function tableSort(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function tableFilter(values: Record<string, string>) {
  columnFilters.value = values;
  page.value = 1;
  load();
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      await nextTick();
      (formRef.value?.$el as HTMLElement | undefined)
        ?.querySelector<HTMLElement>(".el-form-item.is-error input")?.focus();
      ElMessage.warning("请完善标红的必填信息后保存");
      return;
    }
    const c = definitions.value[kind.value];
    const saved = await api<{ warnings?: string[] }>(
      "/catalog/" + kind.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      {
        ...form.value,
        expected_version:
          editing.value?.[c.sequence || "version_no"] ||
          editing.value?.version ||
          1,
      },
    );
    // The form stays locked until its list/detail refresh completes. Otherwise
    // a rapid second creation opens while the previous saving flag is true.
    ElMessage.success("正式版本已保存，正在刷新列表");
    await load();
    await refreshDetail();
    dialog.value = false;
    for (const warning of saved.warnings || []) ElMessage.warning({ message: warning, duration: 8000 });
  } catch (e) {
    errors.value = (e as {fields?:Record<string,string>}).fields || {};
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
async function remove(row: CatalogRow) {
  try {
    await ElMessageBox.confirm(
      "删除后从正常列表与新增选择中移除，正式历史和已有引用保留。",
      "确认删除",
      { type: "warning" },
    );
    const c = definitions.value[kind.value];
    await api("/catalog/" + kind.value + "/" + row.id, "DELETE", {
      expected_version: row[c.sequence || "version_no"] || row.version || 1,
    });
    await load();
    await refreshDetail();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function hydrateDetail(id: string) {
  const requestedKind = kind.value;
  const row = await api<CatalogRow>(`/catalog/${requestedKind}/${id}?deleted=true`);
  history.value = null;
  const names = Object.fromEntries(fields().filter(field => field.type === "ref" && row[field.key])
    .map(field => [field.key, String(row[field.key + "_label"] || "历史关联对象")]));
  return { ...row, reference_names: names };
}

async function refreshDetail() {
  const id = detail.value?.id;
  if (!id) return;
  const value = await hydrateDetail(id);
  if (detail.value?.id === id) detail.value = value;
}
function openDetail(row: CatalogRow) { return detailDialog.open(row.id); }
function display(field: CatalogField, value: unknown) {
  if (value == null || value === "") return "—";
  if (field.type === "money") return "¥" + money(value as number);
  if (field.type === "quantity") return quantity(value as number);
  if (field.type === "length_m") return Number(value) / 1000;
  if (field.type === "ref")
    return detail.value?.reference_names?.[field.key] || "历史关联对象";
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.type === "select" || field.key === "tower_nature") return statusText[String(value)] || value;
  return value;
}
async function viewHistory(row: CatalogRow) {
  if (detail.value?.id !== row.id) await detailDialog.open(row.id);
  if (detail.value?.id !== row.id) return;
  const value = await api<Row>(`/catalog/${kind.value}/history/${row.id}`);
  if (detail.value?.id === row.id) history.value = value;
}
watch(kind, () => {
  rows.value = [];
  history.value = null;
  void load();
});
useListRoute({ q: query, page, deleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load);
const detailDialog = useEntityDialog(detail, hydrateDetail, () => { dialog.value = false; history.value = null; });
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
onMounted(async () => {
  [definitions.value, businessLabels.value] = await Promise.all([
    api<Record<string,CatalogFormDefinition>>("/catalogs"),
    api<Record<string,string>>("/display-labels"),
  ]);
  await load();
});
</script>
<template>
  <div class="page-heading">
      <div>
        <div class="section-caption">基础数据管理</div>
        <h1>{{ title }}</h1>
        <p>统一维护业务定义，正式变更保留版本与关联历史。</p>
      </div>
      <div class="page-heading-actions">
        <ElButton
          :disabled="!can(catalogPermission)"
          type="primary"
          @click="edit()"
          >新增{{ definitions[kind]?.title }}</ElButton
        >

      </div>
    </div>
    <ElTabs v-if="kinds.length > 1" v-model="kind"
      ><ElTabPane
        v-for="key in kinds"
        :key="key"
        :name="key"
        :label="definitions[key]?.title || key"
    /></ElTabs>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          clearable
          placeholder="搜索名称或真实属性"
          @change="
            page = 1;
            load();
          "
        /><ElCheckbox v-model="deleted" @change="page = 1; load()">包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton
        ><span class="muted">共 {{ total }} 项</span>
      </div>
      <BusinessTable :search-active="!!query" @clear-search="query = ''; columnFilters = {}; page = 1; load()" :rows="rows" :columns="tableColumns" :table-key="'catalog:' + kind" :loading="loading" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        :actions-width="180"
        @sort-change="tableSort" @filter-change="tableFilter">
        <template #cell="{ row, column }">
          <ElTag v-if="column.key === 'status'" :type="row.deleted ? 'danger' : row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.deleted ? "已删除" : tableCell(row, column) }}</ElTag>
          <span v-else>{{ tableCell(row, column) }}</span>
        </template>
        <template #actions="{ row }">
          <RowActions :actions="[
            { label: '查看', run: () => openDetail(row) },
            { label: '编辑', disabled: !can(catalogPermission) || row.deleted, run: () => edit(row) },
            { label: '历史', run: () => viewHistory(row) },
            { label: '删除', danger: true, disabled: !can('admin') || row.deleted, run: () => remove(row) },
          ]" />
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :page-size="30"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>

  <BusinessDetailDialog :open="detailOpen" :title="(definitions[kind]?.title || '业务') + '详情'" :loading="detailLoading" :error="detailError"
    @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header">
      <h1>
        {{ detail.label || detail.name || detail.title }}
      </h1>
      <ElTag>{{
        detail.deleted ? "已删除" : statusText[detail.status || ""] || detail.status
      }}</ElTag>
    </div>
    <div class="toolbar">
      <ElButton
        :disabled="!can(catalogPermission) || detail.deleted"
        @click="edit(detail)"
        >编辑</ElButton
       ><ElButton @click="viewHistory(detail)">完整历史</ElButton
      ><ElButton
        type="danger"
        :disabled="!can('admin') || detail.deleted"
        @click="remove(detail)"
        >删除</ElButton
      >
    </div>
    <div class="panel">
      <h2>正式定义</h2>
      <ElDescriptions :column="descriptionColumns" border
        ><ElDescriptionsItem
          v-for="field in fields()"
          :key="field.key"
          :label="field.label"
          :span="field.type === 'json' ? descriptionColumns : 1"
        >
          <span v-if="field.type === 'json'">{{
            factText(detail[field.key], field.key, businessLabels)
          }}</span>
          <span v-else>{{
            display(field, detail[field.key])
          }}</span></ElDescriptionsItem
        ></ElDescriptions
      >
    </div>
    <div v-if="history" class="panel">
      <h2>完整版本与审计历史</h2>
      <BusinessHistory :value="history" /></div
  ></template>
  </BusinessDetailDialog>
  <ElDialog append-to-body
    :key="kind"
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (definitions[kind]?.title || '')"
    width="800px"
    :close-on-click-modal="false"
    :before-close="beforeEditorClose"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <div class="form-grid">
        <ElFormItem
          v-for="f in fields()"
          :key="f.key"
          :label="f.label"
          :prop="f.key"
          :error="errors[f.key]"
          :rules="
            f.required
              ? [
                  {
                    required: true,
                    message: '请填写' + f.label,
                    trigger: 'blur',
                  },
                ]
              : []
          "
          :class="{ 'full-width': f.type === 'json' }"
          ><FieldControl
            v-model="form[f.key]"
            :field="f"
            :disabled="!!editing && !!f.immutable"
        /></ElFormItem>
      </div>
      </ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton
        :disabled="!can(catalogPermission)"
        type="primary"
        :loading="saving"
        @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
