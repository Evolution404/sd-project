<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { resumeTask } from "../../shared/navigation/business-context";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import type {
  DictionaryKind,
  DictionaryItem,
  DictionaryDetail,
  DefinitionStatus,
} from "../../../../server/shared/types/master-data";
import type {
  FieldErrors,
  Page,
} from "../../../../server/shared/types/contracts";
import { api, statusText } from "../../shared/api/client";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useAccess } from "../../shared/composables/use-access";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import BusinessTable from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
const route = useRoute(),
  router = useRouter(),
  can = useAccess();
const returnToDemand = computed(() => typeof route.query.returnTo === "string" &&
  route.query.returnTo.startsWith("/demands") ? route.query.returnTo : null);
function backToDemand() {
  if (returnToDemand.value) resumeTask(router, returnToDemand.value);
}
function continueConfig(target: "objects" | "operations") {
  void router.push({ name: "standards", params: { kind: target },
    query: returnToDemand.value ? { returnTo: returnToDemand.value } : {} });
}
const kind = computed(() => route.params.kind as DictionaryKind);
const titles: Record<DictionaryKind, string> = {
  units: "计量单位",
  priorities: "优先级",
  categories: "项目类别",
  tower_natures: "杆塔性质",
  tower_materials: "杆塔材质",
};
const title = computed(() => titles[kind.value]);
const rows = ref<DictionaryItem[]>([]),
  total = ref(0),
  query = ref(""),
  page = ref(1),
  deleted = ref(false),
  sort = ref(""),
  direction = ref(""),
  filters = ref<Record<string, string>>({}),
  loading = ref(false),
  error = ref("");
const detailState = shallowRef<DictionaryDetail | null>(null);
const detail = computed(() => detailState.value?.item || null),
  history = computed(() => detailState.value?.versions || []);
const editor = ref(false),
  editing = ref<DictionaryItem | null>(null),
  saving = ref(false),
  formRef = ref<FormInstance>();
const fieldErrors = ref<FieldErrors>({});
const form = ref<{ name: string; status: DefinitionStatus; quantity_precision: number }>({
  name: "",
  status: "active",
  quantity_precision: 0,
});
const guard = useDialogDraftGuard(() => form.value);
let sequence = 0;
async function load() {
  const current = ++sequence,
    requested = kind.value;
  loading.value = true;
  error.value = "";
  const parameters = new URLSearchParams({
    page: String(page.value),
    q: query.value,
    deleted: String(deleted.value),
    sort: sort.value || "created_at",
    direction: direction.value || "desc",
    filters: JSON.stringify(filters.value),
  });
  try {
    const result = await api<Page<DictionaryItem>>(
      `/catalog/${requested}?${parameters}`,
    );
    if (current === sequence && requested === kind.value) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
async function fetchDetail(id: string): Promise<DictionaryDetail> {
  return api<DictionaryDetail>(
    `/catalog/${kind.value}/${id}?deleted=true&history=true`,
  );
}
const detailDialog = useEntityDialog(detailState, fetchDetail, () => {
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
function edit(row?: DictionaryItem) {
  editing.value = row || null;
  fieldErrors.value = {};
  form.value = {
    name: row?.name || "", status: row?.status || "active",
    quantity_precision: row?.quantity_precision ?? 0,
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
      `/catalog/${kind.value}` + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      { ...form.value, expected_version: editing.value?.version || 1 },
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
async function remove(row: DictionaryItem) {
  try {
    const impact = await api<{ references: number; expected_version: number }>(
      `/catalog/${kind.value}/${row.id}/deletion-impact`,
    );
    await ElMessageBox.confirm(
      `当前有${impact.references}处正式关联。删除保留原版本和这些关联，并停止新增选用。`,
      "确认删除",
      { type: "warning" },
    );
    await api(`/catalog/${kind.value}/${row.id}`, "DELETE", {
      expected_version: impact.expected_version,
      expected_references: impact.references,
    });
    await refresh();
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
function clear() {
  query.value = "";
  filters.value = {};
  page.value = 1;
  void load();
}
useListRoute({ q: query, page, deleted, sort, direction, filters }, load);
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">基础配置</div>
      <h1>基础数据</h1>
      <p>{{ title }}与正式版本</p>
    </div>

  </div>
  <slot name="tabs" />
  <ElAlert v-if="returnToDemand" type="info" :closable="false"
    title="当前正在补充需求录入所需的基础资料，原需求草稿已暂存。">
    <div class="toolbar">
      <ElButton size="small" @click="continueConfig('objects')">配置作业对象</ElButton>
      <ElButton size="small" @click="continueConfig('operations')">继续配置操作类型</ElButton>
      <ElButton size="small" @click="backToDemand">返回需求录入</ElButton>
    </div>
  </ElAlert>
  <ElAlert v-if="error" :title="error" type="error" :closable="false"
    ><ElButton @click="load">重试</ElButton></ElAlert
  >
  <div class="panel">

    <BusinessTable detail-column="name" @open-detail="detailDialog.open($event.id)"
      :rows="rows"
      :loading="loading"
      :columns="[
        { key: 'name', label: '名称', minWidth: 190 },
        ...(kind === 'units' ? [{ key: 'quantity_precision', label: '数量格式', minWidth: 130 }] : []),
        { key: 'status', label: '状态' },
      ]"
      :table-key="'catalog:' + kind"
      :filter-state="filters"
      :sort-state="{
        prop: sort,
        order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null,
      }"
      :search-active="!!query"
      @clear-search="clear"
      @sort-change="
        (value) => {
          sort = value.key;
          direction = value.order === 'ascending' ? 'asc' : 'desc';
          page = 1;
          load();
        }
      "
      @filter-change="
        (value) => {
          filters = value;
          page = 1;
          load();
        }
      "
    >
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div class="unified-list-tools">
          <div class="toolbar">
<ElInput
        v-model="query"
        clearable
        placeholder="搜索名称或真实属性"
        @change="
          page = 1;
          load();
        "
      /><ElPopover trigger="click" placement="bottom-start"><template #reference><ElButton>筛选</ElButton></template><ElCheckbox data-guide-action="dictionaries.show-deleted"
        v-model="deleted"
        @change="
          page = 1;
          load();
        "
        >包含已删除</ElCheckbox
      ></ElPopover>
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除检索与列筛选</ElButton>
          </div>
    <div class="toolbar page-heading-actions">
      <ElButton :loading="loading" @click="load">刷新</ElButton>
      <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
      <ElButton :data-guide-action="kind === 'tower_natures' ? 'dictionaries.tower-nature' : kind === 'tower_materials' ? 'dictionaries.tower-material' : kind === 'units' ? 'dictionaries.unit' : 'dictionaries.category'" type="primary" v-if="can('admin')" @click="edit()"
        >新增{{ title }}</ElButton
      >
    </div>
        </div>
      </template>
      <template #cell="{ row, column, value }"
        ><ElTag
          v-if="column.key === 'status'"
          :type="
            row.deleted
              ? 'danger'
              : row.status === 'active'
                ? 'success'
                : 'info'
          "
          effect="plain"
          >{{ row.deleted ? "已删除" : statusText[row.status] }}</ElTag
        ><span v-else-if="column.key === 'quantity_precision'">{{ row.quantity_precision === 0 ? '整数' : '最多' + row.quantity_precision + '位小数' }}</span
        ><span v-else>{{ value }}</span></template
      >
 </BusinessTable
    ><ElPagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="prev,pager,next,total"
      @current-change="load"
    />
  </div>
  <BusinessDetailDialog
    :open="detailDialog.isOpen.value"
    :title="title + '详情'"
    :loading="detailDialog.loading.value"
    :error="detailDialog.error.value"
    @close="detailDialog.close"
    @retry="detailDialog.reload"
    ><template v-if="detail"
      ><div class="detail-header">
        <h1>{{ detail.name }}</h1>
        <ElTag>{{
          detail.deleted ? "已删除" : statusText[detail.status]
        }}</ElTag>
      </div>
      <div class="toolbar">
        <ElButton data-guide-action="dictionaries.edit"
          v-if="can('admin') && !detail.deleted"
          @click="edit(detail)"
          >编辑</ElButton
        ><ElButton data-guide-action="dictionaries.delete"
          type="danger"
          v-if="can('admin') && !detail.deleted"
          @click="remove(detail)"
          >删除</ElButton
        >
      </div>
      <ElDescriptions :column="1" :label-width="150" border
        ><ElDescriptionsItem label="名称">{{ detail.name }}</ElDescriptionsItem
        ><ElDescriptionsItem label="状态">{{
          statusText[detail.status]
        }}</ElDescriptionsItem
        ><ElDescriptionsItem v-if="kind === 'units'" label="允许数量格式">{{ detail.quantity_precision === 0 ? '只能填写整数' : '最多' + detail.quantity_precision + '位小数' }}</ElDescriptionsItem
        ><ElDescriptionsItem label="正式版本"
          >第{{ detail.version }}版</ElDescriptionsItem
        ></ElDescriptions
      >
      <h2 data-guide-action="dictionaries.history">完整版本与审计历史</h2>
      <BusinessHistory
        :value="{
          versions: history,
          audit_events: detailState?.audits,
        }" /></template
  ></BusinessDetailDialog>
  <ElDialog
    v-model="editor"
    append-to-body
    :title="(editing ? '编辑' : '新增') + title"
    width="620px"
    :close-on-click-modal="false"
    :before-close="close"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><ElFormItem
        label="名称"
        prop="name"
        :error="String(fieldErrors.name || '')"
        :rules="[{ required: true, message: '请填写名称' }]"
        ><ElInput v-model="form.name" /></ElFormItem
      ><ElFormItem v-if="kind === 'units'" label="数量格式" prop="quantity_precision"
        :error="String(fieldErrors.quantity_precision || '')">
        <ElSelect v-model="form.quantity_precision">
          <ElOption :value="0" label="整数（不允许小数）" />
          <ElOption :value="1" label="最多1位小数" />
          <ElOption :value="2" label="最多2位小数" />
          <ElOption :value="3" label="最多3位小数" />
          <ElOption :value="4" label="最多4位小数" />
        </ElSelect>
      </ElFormItem>
      <ElAlert v-if="kind === 'units' && editing" type="info" :closable="false"
        title="调整数量格式将生成新的单位正式版本；既有操作和需求沿用原版本，不会追溯修改。" />
      <ElFormItem label="状态"
        ><ElSelect v-model="form.status"
          ><ElOption value="active" label="启用" /><ElOption
            value="inactive"
            label="停用" /></ElSelect></ElFormItem></ElForm
    ><template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="dictionaries.save" type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    ></ElDialog
  >
</template>
