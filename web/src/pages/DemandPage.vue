<script setup lang="ts">
import BusinessHistory from "../components/BusinessHistory.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../components/FieldControl.vue";
import PricingQuoteDialog from "../components/PricingQuoteDialog.vue";
import SiteFeaturesEditor from "../components/SiteFeaturesEditor.vue";
import EvidencePanel from "../components/EvidencePanel.vue";
import ExchangePanel from "../components/ExchangePanel.vue";
import { api, type Row, quantity, statusText } from "../services/api";
const adoptedOperation = ref<Row | null>(null),
  lastOperationId = ref("");
const props = defineProps<{ user: Row }>();
const rows = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
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
async function load() {
  const result = await api(
    `/demands?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${showDeleted.value}`,
  );
  rows.value = result.items;
  total.value = result.total;
  if (detail.value)
    detail.value = await api("/demands/" + detail.value.id + "?deleted=true");
}
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
  form.value.custom_fields = value?.custom_fields || {};
  adoptedOperation.value = value
    ? (await api("/catalog/operations/history/" + value.operation_id)).find(
        (definition: Row) => definition.version === value.operation_version,
      )
    : null;
  lastOperationId.value = form.value.operation_id;
  errors.value = {};
  dialog.value = true;
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
  if (!(await formRef.value?.validate().catch(() => false))) return;
  loading.value = true;
  try {
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
    dialog.value = false;
    await load();
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
    detail.value = null;
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
onMounted(async () => {
  operations.value = (await api("/catalog/operations?page_size=200")).items;
  businessLabels.value = await api("/display-labels");
  await load();
});
</script>
<template>
  <template v-if="!detail"
    ><div class="page-heading">
      <div>
        <div class="section-caption">Professional demands</div>
        <h1>专业需求</h1>
        <p>一种操作，多处作业位置。数量、现场条件与来源分别留存。</p>
      </div>
      <div>
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
          @change="load"
        /><ElCheckbox v-model="showDeleted" @change="load"
          >包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton>
      </div>
      <ElTable :data="rows" @selection-change="selected = $event"
        ><ElTableColumn type="selection" width="42" /><ElTableColumn
          prop="demand_no"
          label="需求编号"
          width="140"
          sortable
        /><ElTableColumn
          prop="operation_snapshot"
          label="操作类型"
          min-width="150"
        /><ElTableColumn
          prop="problem_description"
          label="问题描述"
          min-width="200"
        /><ElTableColumn label="数量 / 位置" width="130"
          ><template #default="{ row }"
            >{{ quantity(row.quantity_scaled) }} {{ row.unit_snapshot }}
            <div class="muted">
              {{ row.work_locations.length }} 处位置
            </div></template
          ></ElTableColumn
        ><ElTableColumn label="状态" width="100"
          ><template #default="{ row }"
            ><ElTag>{{
              row.deleted ? "已删除" : statusText[row.status]
            }}</ElTag></template
          ></ElTableColumn
        ><ElTableColumn label="当前关联" min-width="100"
          ><template #default="{ row }">{{
            row.binding ? "已关联子项目" : "未关联"
          }}</template></ElTableColumn
        ><ElTableColumn label="操作" width="100"
          ><template #default="{ row }"
            ><ElButton
              size="small"
              @click="
                api('/demands/' + row.id + '?deleted=true').then(
                  (value) => (detail = value),
                )
              "
              >查看</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      ><ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      /></div
  ></template>
  <template v-else
    ><div class="detail-header">
      <ElButton @click="detail = null">返回需求列表</ElButton>
      <h1>{{ detail.demand_no }} · {{ detail.operation_snapshot }}</h1>
      <ElTag
        >{{ statusText[detail.status] }} · V{{ detail.current_version }}</ElTag
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
      <ElDescriptions :column="2" border
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
      <ElTable :data="detail.work_locations"
        ><ElTableColumn label="位置" min-width="180"
          ><template #default="{ row }"
            >{{ row.location_snapshot_json.line_name }}
            {{
              row.location_snapshot_json.location_label ||
              row.location_snapshot_json.tower_no ||
              row.location_snapshot_json.physical_code ||
              row.span_id
            }}</template
          ></ElTableColumn
        ><ElTableColumn label="数量" width="130"
          ><template #default="{ row }">{{
            quantity(row.quantity_scaled)
          }}</template></ElTableColumn
        ><ElTableColumn label="作业方式"
          ><template #default="{ row }">{{
            statusText[row.work_mode] || row.work_mode
          }}</template></ElTableColumn
        ><ElTableColumn label="现场特征"
          ><template #default="{ row }">{{
            Object.entries(row.site_features_json)
              .map(
                ([key, value]) =>
                  (businessLabels[key + "@" + (value as Row).factor_version] ||
                    businessLabels[key] ||
                    "历史价格特征") +
                  " · " +
                  (value as Row).value,
              )
              .join(" / ") || "—"
          }}</template></ElTableColumn
        ></ElTable
      >
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
      <ElTable :data="detail.materials"
        ><ElTableColumn prop="material_name" label="物资名称" /><ElTableColumn
          prop="model"
          label="型号"
        /><ElTableColumn prop="specification" label="规格" /><ElTableColumn
          label="预计数量"
          ><template #default="{ row }"
            >{{ quantity(row.quantity_scaled) }}
            {{ row.unit_snapshot }}</template
          ></ElTableColumn
        ></ElTable
      >
    </div>
    <EvidencePanel
      :key="detail.id"
      owner-kind="demand_id"
      :owner-id="detail.id"
  /></template>
  <ElDialog
    v-model="dialog"
    :title="editing ? '修订需求' : '新增专业需求'"
    width="1000px"
    :close-on-click-modal="false"
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
            ><ElSelect v-model="loc.location_kind"
              ><ElOption label="杆塔" value="logical_tower" /><ElOption
                label="档距"
                value="span" /></ElSelect></ElFormItem
          ><ElFormItem
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
              }" /></ElFormItem
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
          @click="form.work_locations.splice(index, 1)"
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
      ><ElButton @click="dialog = false">取消</ElButton
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
  <ElDialog
    :model-value="!!history"
    title="需求完整历史"
    width="900px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>
