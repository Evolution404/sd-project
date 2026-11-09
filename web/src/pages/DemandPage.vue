<script setup lang="ts">
import BusinessDetailDialog from "../components/BusinessDetailDialog.vue";
import { useEntityDialog } from "../services/entity-dialog";
import { useDescriptionColumns } from "../services/responsive-descriptions";import { useDialogDraftGuard } from "../services/dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useListRoute } from "../services/page-navigation";
import BusinessHistory from "../components/BusinessHistory.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../components/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import PricingQuoteDialog from "../components/PricingQuoteDialog.vue";
import SiteFeaturesEditor from "../components/SiteFeaturesEditor.vue";
import EvidencePanel from "../components/EvidencePanel.vue";
import ExchangePanel from "../components/ExchangePanel.vue";
import { api, type Row, quantity, statusText } from "../services/api";
const adoptedOperation = ref<Row | null>(null),
  lastOperationId = ref("");
const props = defineProps<{ user: Row }>();
const rows = ref<Row[]>([]),
  listLoading = ref(false),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  selected = ref<Row[]>([]),
  detail = ref<Row | null>(null),
  dialog = ref(false),
  loading = ref(false),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  operations = ref<Row[]>([]),
  businessLabels = ref<Row>({}),
  errors = ref<Row>({}),
  history = ref<Row | null>(null),
  quoteOpen = ref(false),
  formRef = ref(),
  showDeleted = ref(false);
const locationLineIds = ref<(string | null)[]>([]);
function clearLocationDevice(loc: Row) {
  loc.logical_tower_id = null;
  loc.physical_tower_id = null;
  loc.span_id = null;
  loc.span_version = undefined;
  loc.site_features_json = "{}";
  loc.adopt_current_definition = true;
}
function changeLocationKind(loc: Row) {
  clearLocationDevice(loc);
}
function removeLocation(index: number) {
  form.value.work_locations.splice(index, 1);
  locationLineIds.value.splice(index, 1);
}
const operation = computed(() =>
  adoptedOperation.value?.operation_id === form.value.operation_id &&
  adoptedOperation.value?.version === form.value.operation_version
    ? adoptedOperation.value
    : operations.value.find((item) => item.id === form.value.operation_id),
);
const extraFields = computed(() =>
  JSON.parse(operation.value?.fields_json || "[]"),
);
const locationReference = computed(() =>
  operation.value?.work_target_type === "physical" ? "physical" : "towers",
);
const demandLocationColumns: TableColumn[] = [
  { key: "location_snapshot_json", label: "位置", minWidth: 230, sortable: false, filterable: false },
  { key: "quantity_scaled", label: "数量", minWidth: 135 },
  { key: "work_mode", label: "作业方式", minWidth: 130 },
  { key: "site_features_json", label: "现场特征", minWidth: 230, sortable: false, filterable: false },
];
const demandMaterialColumns: TableColumn[] = [
  { key: "material_name", label: "物资名称", minWidth: 165 },
  { key: "model", label: "型号", minWidth: 145 },
  { key: "specification", label: "规格", minWidth: 145 },
  { key: "quantity_scaled", label: "预计数量", minWidth: 165 },
];
function resetListPage() {
  page.value = 1;
  void load();
}
const demandColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 150 },
  { key: "operation_snapshot", label: "操作类型", minWidth: 160 },
  { key: "problem_description", label: "问题描述", minWidth: 200 },
  { key: "quantity_scaled", label: "工作量" },
  { key: "unit_snapshot", label: "计量单位" },
  { key: "work_locations", filterable: false, label: "作业位置数", sortable: false },
  { key: "status", label: "状态" },
  { key: "binding", filterable: false, label: "当前关联", sortable: false },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const result = await api(
      `/demands?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${showDeleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
    );
    if (sequence !== loadSequence) return;
    rows.value = result.items;
    total.value = result.total;
    const id = detail.value?.id;
    if (id) {
      const updated = await api("/demands/" + id + "?deleted=true");
      if (sequence === loadSequence && detail.value?.id === id) detail.value = updated;
    }
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
async function edit(row?: Row) {
  editing.value = row || null;
  const value = row ? await api("/demands/" + row.id) : null;
  form.value = value
    ? structuredClone(value)
    : {
        demand_no: "",
        operation_id: "",
        problem_description: "",
        completion_standard: "",
        work_locations: [],
        materials: [],
        sources: [{ description: "", discovered_on: "" }],
      };
  for (const loc of form.value.work_locations)
    loc.site_features_json = JSON.stringify(loc.site_features_json || {});
  // A historical selected object must remain visible even outside the current
  // search range; infer its actual line only from persisted relationships.
  locationLineIds.value = await Promise.all(form.value.work_locations.map(async (loc: Row) => {
    const selectedId = loc.location_kind === "span" ? loc.span_id
      : loc.location_kind === "physical_tower" ? loc.physical_tower_id
        : loc.logical_tower_id;
    if (!selectedId) return null;
    const target = loc.location_kind === "span" ? "spans"
      : loc.location_kind === "physical_tower" ? "physical" : "towers";
    try {
      const item = await api("/catalog/" + target + "/" + selectedId + "?deleted=true");
      if (target === "physical") {
        const active = item.bindings?.filter((link: Row) =>
          link.logical_status !== "retired" && !link.logical_deleted) || [];
        const unique = [...new Set(active.map((link: Row) => link.line_id))];
        return unique.length === 1 ? String(unique[0]) : null;
      }
      return item.line_id || null;
    } catch { return null; }
  }));
  form.value.custom_fields = value?.custom_fields || {};
  adoptedOperation.value = value
    ? (await api("/catalog/operations/history/" + value.operation_id)).find(
        (definition: Row) => definition.version === value.operation_version,
      )
    : null;
  lastOperationId.value = form.value.operation_id;
  errors.value = {};
  dialog.value = true;
  draftGuard.capture();
}
async function chooseOperation() {
  const selected = operations.value.find(
    (item) => item.id === form.value.operation_id,
  );
  if (!selected) return;
  const incompatible = form.value.work_locations.some(
    (loc: Row) =>
      (selected.work_target_type === "physical") !==
        (loc.location_kind === "physical_tower") ||
      (loc.location_kind === "span"
        ? !selected.allow_span
        : !selected.allow_tower),
  );
  if (incompatible) {
    try {
      await ElMessageBox.confirm(
        "新操作不适用当前作业位置，请重新选择真实设备。",
        "切换操作类型",
        { confirmButtonText: "重新选择位置", cancelButtonText: "保留原操作" },
      );
      form.value.work_locations = [];
      locationLineIds.value = [];
    } catch {
      form.value.operation_id = lastOperationId.value;
      return;
    }
  }
  form.value.operation_version = selected.version;
  lastOperationId.value = selected.id;
  form.value.custom_fields = Object.fromEntries(
    JSON.parse(selected.fields_json || "[]").map((field: Row) => [
      field.key,
      form.value.custom_fields?.[field.key] ?? field.default ?? null,
    ]),
  );
  form.value.completion_standard ||= selected.completion_standard;
  form.value.target_object = selected.default_target_object;
  if (!form.value.work_locations.length) addLocation();
}
function addLocation() {
  const op = operation.value;
  locationLineIds.value.push(null);
  form.value.work_locations.push({
    location_kind:
      op?.work_target_type === "physical"
        ? "physical_tower"
        : op?.default_location_kind === "span"
          ? "span"
          : "logical_tower",
    quantity_scaled: op?.default_quantity_scaled || 10000,
    work_mode: "unspecified",
    site_features_json: "{}",
  });
}
async function save() {
  if (loading.value) return;
  loading.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    const unavailable = (form.value.work_locations || []).find((location: Row) =>
      location.price_features_load_error || location.price_features_loading);
    if (unavailable) {
      ElMessage.error(unavailable.price_features_load_error ||
        "现场计价信息尚未加载完毕，请稍后保存");
      return;
    }
    const input = {
      ...Object.fromEntries(
        [
          "demand_no",
          "operation_id",
          "operation_version",
          "problem_description",
          "target_object",
          "completion_standard",
          "priority_id",
          "expected_on",
          "work_locations",
          "materials",
          "custom_fields",
          "duplicate_decision",
          "duplicate_matches",
        ].map((key) => [key, form.value[key]]),
      ),
      expected_version: editing.value?.current_version,
      sources: form.value.sources.filter((x: Row) => x.id || x.description),
    };
    await api(
      "/demands" + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      input,
    );
    await load();
    dialog.value = false;
    ElMessage.success("需求版本已保存");
  } catch (e) {
    errors.value = (e as Row).fields || {};
    if (errors.value.duplicates) {
      try {
        await ElMessageBox.confirm(
          "与需求 " +
            errors.value.duplicates.join("、") +
            " 的操作和位置重复。确认现场事实属于独立需求并分别保留？",
          "疑似重复需求复核",
          { confirmButtonText: "确认为独立需求", cancelButtonText: "返回核对" },
        );
        form.value.duplicate_decision = "separate";
        form.value.duplicate_matches = errors.value.duplicates;
        loading.value = false;
        await save();
      } catch {}
    } else ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
async function transition(row: Row, status: string) {
  try {
    await ElMessageBox.confirm(
      "确认记录此次正式需求状态决定？",
      statusText[status],
    );
    const timeline = await api("/demands/" + row.id + "/history");
    await api("/demands/" + row.id + "/status", "POST", {
      status,
      expected_version: row.current_version,
      expected_event_seq: timeline.events.at(-1).event_seq,
    });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function removeSource(source: Row) {
  try {
    await ElMessageBox.confirm(
      "从当前来源列表移除，原始来源、证据及历史引用保留。",
      "删除来源",
    );
    await api("/sources/" + source.id, "DELETE", {});
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function showHistory() {
  history.value = await api("/demands/" + detail.value!.id + "/history");
}
async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除后从正常列表移除，正式历史继续可查。须先取消需求并解除当前关联。",
      "删除需求",
    );
    await api("/demands/" + row.id, "DELETE", {
      expected_version: row.current_version,
    });
    await detailDialog.close();
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
useListRoute({ q: query, page, deleted: showDeleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load);
const detailDialog = useEntityDialog(detail, id => api('/demands/' + id + '?deleted=true'), () => { dialog.value = false; history.value = null; quoteOpen.value = false; });
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
onMounted(async () => {
  operations.value = (await api("/catalog/operations?page_size=200")).items;
  businessLabels.value = await api("/display-labels");
  await load();
});
</script>
<template>
  <div class="page-heading">
      <div>
        <div class="section-caption">专业需求管理</div>
        <h1>专业需求</h1>
        <p>一种操作，多处作业位置。数量、现场条件与来源分别留存。</p>
      </div>
      <div class="page-heading-actions">
        <ExchangePanel
          kind="demands"
          :selected-ids="selected.map((x) => x.id)"
          :query="query"
          @changed="load"
        /><ElButton :disabled="!can('write')" type="primary" @click="edit()"
          >新增需求</ElButton
        >
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          placeholder="需求编号、问题或位置"
          clearable
          @change="resetListPage"
        /><ElCheckbox v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton>
      </div>
      <BusinessTable :loading="listLoading" :rows="rows" :columns="demandColumns" table-key="demand:list" selectable :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        @selection-change="selected = $event" @sort-change="sortTable" @filter-change="filterTable">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
          <span v-else-if="column.key === 'work_locations'">{{ row.work_locations?.length || 0 }} 处</span>
          <span v-else-if="column.key === 'binding'">{{ row.binding ? '已关联子项目' : '未关联' }}</span>
          <ElTag v-else-if="column.key === 'status'" effect="plain">{{ row.deleted ? "已删除" : statusText[row.status] }}</ElTag>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
        <template #actions="{ row }">
          <ElButton size="small" @click="detailDialog.open(row.id)">查看</ElButton>
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      /></div
  >
  <BusinessDetailDialog :open="detailOpen" title="需求详情" :loading="detailLoading" :error="detailError"
    @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header">
      <h1>{{ detail.demand_no }} · {{ detail.operation_snapshot }}</h1>
      <ElTag
        >{{ statusText[detail.status] }} · 第 {{ detail.current_version }} 版</ElTag
      >
    </div>
    <div class="toolbar">
      <ElButton :disabled="!can('write')" @click="edit(detail)"
        >修订需求</ElButton
      ><ElButton @click="showHistory()">完整历史</ElButton
      ><ElButton @click="quoteOpen = true">参考价试算</ElButton
      ><ElButton
        :disabled="!can('demand.activate')"
        v-if="
          ['admin', 'verifier'].includes(user.role) &&
          detail.status !== 'active' &&
          detail.status !== 'cancelled'
        "
        type="primary"
        @click="transition(detail, 'active')"
        >确认有效</ElButton
      ><ElButton
        :disabled="!can('demand.activate')"
        v-if="detail.status === 'active'"
        @click="transition(detail, 'returned')"
        >退回</ElButton
      ><ElButton
        :disabled="!can('demand.activate')"
        v-if="detail.status !== 'cancelled'"
        type="danger"
        plain
        @click="transition(detail, 'cancelled')"
        >取消需求</ElButton
      ><ElButton :disabled="!can('admin')" type="danger" @click="remove(detail)"
        >删除</ElButton
      >
    </div>
    <div class="panel">
      <h2>需求定义</h2>
      <ElDescriptions :column="descriptionColumns" border
        ><ElDescriptionsItem label="问题描述">{{
          detail.problem_description
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="总工作量"
          >{{ quantity(detail.quantity_scaled) }}
          {{ detail.unit_snapshot }}</ElDescriptionsItem
        ><ElDescriptionsItem label="作业对象">{{
          detail.work_object_snapshot
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="验收标准">{{
          detail.completion_standard
        }}</ElDescriptionsItem></ElDescriptions
      >
    </div>
    <div class="panel">
      <h2>作业位置</h2>
      <BusinessTable client-side table-key="demand:detail-locations"
        :rows="detail.work_locations || []" :columns="demandLocationColumns">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'location_snapshot_json'">
            {{ row.location_snapshot_json?.line_name || '' }}
            {{ row.location_snapshot_json?.location_label || row.location_snapshot_json?.tower_no || row.location_snapshot_json?.physical_code || row.span_id }}
          </span>
          <span v-else-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
          <span v-else-if="column.key === 'work_mode'">{{ statusText[row.work_mode] || row.work_mode }}</span>
          <span v-else-if="column.key === 'site_features_json'">
            {{ Object.entries(row.site_features_json || {}).map(([key, value]) =>
              (businessLabels[key + '@' + (value as Row).factor_version] || businessLabels[key] || '历史价格特征') +
              ' · ' + (value as Row).value).join(' / ') || '—' }}
          </span>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <div class="panel">
      <h2>来源与预计物资</h2>
      <p v-for="source in detail.sources" :key="source.id">
        {{ source.description }}
        <span class="muted">{{ source.discovered_on }}</span
        ><ElButton :disabled="!can('write')" size="small" @click="edit(detail)"
          >更正</ElButton
        ><ElButton
          :disabled="!can('admin')"
          size="small"
          type="danger"
          @click="removeSource(source)"
          >删除</ElButton
        >
      </p>
      <BusinessTable client-side table-key="demand:detail-materials"
        :rows="detail.materials || []" :columns="demandMaterialColumns">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }} {{ row.unit_snapshot }}</span>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <EvidencePanel
      :key="detail.id"
      owner-kind="demand_id"
      :owner-id="detail.id"
  /></template>
  </BusinessDetailDialog>
  <ElDialog append-to-body
    v-model="dialog"
    :title="editing ? '修订需求' : '新增专业需求'"
    width="1000px"
    :close-on-click-modal="false" :before-close="beforeEditorClose"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><div class="form-grid">
        <ElFormItem
          label="操作类型"
          prop="operation_id"
          :rules="[{ required: true, message: '请选择操作类型' }]"
          ><ElSelect
            v-model="form.operation_id"
            filterable
            @change="chooseOperation"
            ><ElOption
              v-for="op in operations"
              :key="op.id"
              :value="op.id"
              :label="op.name" /></ElSelect></ElFormItem
        ><ElFormItem
          label="问题描述"
          prop="problem_description"
          :rules="[{ required: true, message: '请填写问题描述' }]"
          ><ElInput
            v-model="form.problem_description"
            type="textarea" /></ElFormItem
        ><ElFormItem
          label="验收标准"
          prop="completion_standard"
          :rules="[{ required: true, message: '请填写验收标准' }]"
          ><ElInput v-model="form.completion_standard" type="textarea"
        /></ElFormItem>
      </div>
      <ElCollapse
        ><ElCollapseItem title="优先级与期望日期（按需填写）" name="priority"
          ><div class="form-grid">
            <ElFormItem label="优先级"
              ><FieldControl
                v-model="form.priority_id"
                :field="{ type: 'ref', reference: 'priorities' }" /></ElFormItem
            ><ElFormItem label="期望日期"
              ><ElDatePicker
                v-model="form.expected_on"
                value-format="YYYY-MM-DD"
            /></ElFormItem></div></ElCollapseItem
      ></ElCollapse>
      <div v-if="extraFields.length" class="form-grid">
        <ElFormItem
          v-for="field in extraFields"
          :key="field.key"
          :label="field.label"
          :prop="['custom_fields', field.key]"
          :required="field.required"
          :rules="
            field.required
              ? [{ required: true, message: '请填写' + field.label }]
              : []
          "
          :error="errors['custom_fields.' + field.key]"
          ><FieldControl
            v-model="form.custom_fields[field.key]"
            :field="{
              ...field,
              booleanNative: true,
              type: field.type === 'number' ? 'decimal' : field.type,
            }"
        /></ElFormItem>
      </div>
      <h3 class="subheading">作业位置与工作量</h3>
      <ElAlert
        v-if="operation"
        :title="
          '作业对象和单位由操作定义自动取得。' + (operation.entry_hint || '')
        "
        type="info"
        :closable="false"
      />
      <div
        v-for="(loc, index) in form.work_locations"
        :key="index"
        class="panel"
      >
        <div class="form-grid">
          <ElFormItem
            v-if="operation?.allow_span && operation?.allow_tower"
            label="位置类型"
            ><ElSelect v-model="loc.location_kind" @change="changeLocationKind(loc)"
              ><ElOption label="杆塔" value="logical_tower" /><ElOption
                label="档距"
                value="span" /></ElSelect></ElFormItem
          ><ElFormItem label="所属线路（筛选作业设备）">
            <FieldControl v-model="locationLineIds[Number(index)]"
              :field="{ type: 'ref', reference: 'lines' }"
              @update:model-value="clearLocationDevice(loc)" />
          </ElFormItem>
          <ElFormItem
            label="作业设备"
            :prop="[
              'work_locations',
              String(index),
              loc.location_kind === 'span'
                ? 'span_id'
                : loc.location_kind === 'physical_tower'
                  ? 'physical_tower_id'
                  : 'logical_tower_id',
            ]"
            :rules="[{ required: true, message: '请选择真实作业设备' }]"
            required
            ><FieldControl
              v-model="
                loc[
                  loc.location_kind === 'span'
                    ? 'span_id'
                    : loc.location_kind === 'physical_tower'
                      ? 'physical_tower_id'
                      : 'logical_tower_id'
                ]
              "
              @update:model-value="
                loc.adopt_current_definition = true;
                loc.span_version = undefined;
                loc.site_features_json = '{}';
              "
              :field="{
                type: 'ref',
                reference:
                  loc.location_kind === 'span' ? 'spans' : locationReference,
              }"
              :filters="locationLineIds[Number(index)] ? { line_id: locationLineIds[Number(index)]! } : {}" /></ElFormItem
          ><ElFormItem
            label="实际数量"
            :prop="['work_locations', String(index), 'quantity_scaled']"
            :rules="[
              { required: true, message: '请填写实际数量' },
              { type: 'number', min: 1, message: '实际数量必须大于0' },
            ]"
            required
            ><FieldControl
              v-model="loc.quantity_scaled"
              :field="{ type: 'quantity' }" /></ElFormItem
          ><ElFormItem label="作业方式"
            ><ElSelect v-model="loc.work_mode"
              ><ElOption label="未明确" value="unspecified" /><ElOption
                label="停电"
                value="outage" /><ElOption
                label="不停电"
                value="non_outage" /></ElSelect
          ></ElFormItem>
        </div>
        <SiteFeaturesEditor :operation="operation" :location="loc" />
        <ElButton
          type="danger"
          plain
          @click="removeLocation(Number(index))"
          >移除此位置</ElButton
        >
      </div>
      <ElButton :disabled="!operation" @click="addLocation">添加位置</ElButton>
      <h3 class="subheading">预计物资（可不填）</h3>
      <div v-for="(item, index) in form.materials" :key="index" class="toolbar">
        <FieldControl
          v-model="item.material_id"
          :field="{ type: 'ref', reference: 'materials' }"
        /><FieldControl
          v-model="item.quantity_scaled"
          :field="{ type: 'quantity' }"
        /><ElButton type="danger" @click="form.materials.splice(index, 1)"
          >移除</ElButton
        >
      </div>
      <ElButton @click="form.materials.push({ quantity_scaled: 10000 })"
        >添加预计物资</ElButton
      >
      <h3 class="subheading">来源依据</h3>
      <div
        v-for="(source, index) in form.sources"
        :key="index"
        class="form-grid"
      >
        <ElFormItem label="来源说明"
          ><ElInput v-model="source.description" /></ElFormItem
        ><ElFormItem label="发现日期"
          ><ElDatePicker
            v-model="source.discovered_on"
            value-format="YYYY-MM-DD"
        /></ElFormItem>
      </div>
      <ElButton @click="form.sources.push({ description: '' })"
        >补充来源</ElButton
      ></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton
        :disabled="!can('write')"
        type="primary"
        :loading="loading"
        @click="save"
        >保存需求版本</ElButton
      ></template
    ></ElDialog
  >
  <PricingQuoteDialog
    v-if="detail"
    v-model="quoteOpen"
    :demand-id="detail.id"
    :expected-version="detail.current_version"
    @confirmed="load"
  />
  <ElDialog append-to-body
    :model-value="!!history"
    title="需求完整历史"
    width="900px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>
