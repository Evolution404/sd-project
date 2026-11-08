<script setup lang="ts">
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, watch, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ExtraFieldsEditor from "../components/ExtraFieldsEditor.vue";
import FactorDefinitionEditor from "../components/FactorDefinitionEditor.vue";
import PriceConditionsEditor from "../components/PriceConditionsEditor.vue";
import OperationFeaturesEditor from "../components/OperationFeaturesEditor.vue";
import PricingModelEditor from "../components/PricingModelEditor.vue";
import FieldControl from "../components/FieldControl.vue";
import { api, type Row, statusText, money, quantity } from "../services/api";
const props = defineProps<{ kinds: string[]; title: string }>();
const definitions = ref<Row>({}),
  kind = ref(props.kinds[0]!),
  rows = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  deleted = ref(false),
  selected = ref<Row[]>([]),
  dialog = ref(false),
  loading = ref(false),
  editing = ref<Row | null>(null),
  form = ref<Row>({}),
  errors = ref<Row>({}),
  formRef = ref(),
  detail = ref<Row | null>(null),
  referenceNames = ref<Row>({}),
  history = ref<Row | null>(null),
  tab = ref("basic");
const catalogPermission = computed(() =>
  ["frameworks", "agreements"].includes(kind.value) ? "write" : "admin",
);
async function load() {
  loading.value = true;
  try {
    const result = await api(
      `/catalog/${kind.value}?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${deleted.value}`,
    );
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
function edit(row?: Row, historical = false) {
  editing.value = row || null;
  errors.value = {};
  form.value = { historical_update: historical };
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
  tab.value = "basic";
  dialog.value = true;
}
function fields() {
  const c = definitions.value[kind.value];
  return c ? [...c.rootFields, ...c.fields] : [];
}
function visible(f: Row) {
  if (kind.value === "factors" && f.key === "fields_json") return false;
  if (
    kind.value === "operations" &&
    ["pricing_features_json", "fields_json"].includes(f.key)
  )
    return false;
  if (kind.value !== "prices") return true;
  if (
    [
      "additional_conditions_json",
      "calculation_params_json",
      "quantity_brackets_json",
      "fee_components_json",
    ].includes(f.key)
  )
    return false;
  if (f.key === "base_fee_fen")
    return form.value.pricing_mode === "base_plus_unit";
  if (f.key === "unit_price_fen")
    return ["fixed", "per_unit", "base_plus_unit"].includes(
      form.value.pricing_mode,
    );
  return true;
}
function group(f: Row) {
  if (kind.value !== "operations") return "basic";
  if (["fields_json", "pricing_features_json"].includes(f.key)) return "extra";
  if (
    [
      "completion_standard",
      "entry_hint",
      "default_target_object",
      "default_quantity_scaled",
    ].includes(f.key)
  )
    return "template";
  return "basic";
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  loading.value = true;
  try {
    const c = definitions.value[kind.value];
    await api(
      "/catalog/" + kind.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      {
        ...form.value,
        ...(kind.value === "prices"
          ? {
              base_fee_fen:
                form.value.pricing_mode === "base_plus_unit"
                  ? form.value.base_fee_fen
                  : 0,
              unit_price_fen: ["fixed", "per_unit", "base_plus_unit"].includes(
                form.value.pricing_mode,
              )
                ? form.value.unit_price_fen
                : 0,
              quantity_brackets_json:
                form.value.pricing_mode === "quantity_bracket"
                  ? form.value.quantity_brackets_json
                  : "[]",
              fee_components_json:
                form.value.pricing_mode === "composite"
                  ? form.value.fee_components_json
                  : "[]",
            }
          : {}),
        expected_version:
          editing.value?.[c.sequence || "version_no"] ||
          editing.value?.version ||
          1,
      },
    );
    dialog.value = false;
    ElMessage.success("已保存正式版本");
    await load();
    if (detail.value)
      detail.value = await api(
        `/catalog/${kind.value}/${detail.value.id}?deleted=true`,
      );
  } catch (e) {
    errors.value = (e as Row).fields || {};
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
async function remove(row: Row) {
  await ElMessageBox.confirm(
    "删除后从正常列表与新增选择中移除，正式历史和已有引用保留。",
    "确认删除",
    { type: "warning" },
  );
  const c = definitions.value[kind.value];
  try {
    await api("/catalog/" + kind.value + "/" + row.id, "DELETE", {
      expected_version: row[c.sequence || "version_no"] || row.version || 1,
    });
    await load();
    if (detail.value)
      detail.value = await api(
        `/catalog/${kind.value}/${detail.value.id}?deleted=true`,
      );
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function openDetail(row: Row) {
  detail.value = row;
  history.value = null;
  referenceNames.value = {};
  for (const field of fields().filter(
    (field) => field.type === "ref" && row[field.key],
  )) {
    try {
      const record = await api(
        `/catalog/${field.reference}/${row[field.key]}?deleted=true`,
      );
      referenceNames.value[field.key] =
        record.name || record.tower_no || record.tower_code || record.code;
    } catch {
      referenceNames.value[field.key] = row[field.key];
    }
  }
}
function display(field: Row, value: unknown) {
  if (value == null || value === "") return "—";
  if (field.type === "money") return "¥" + money(value as number);
  if (field.type === "quantity") return quantity(value as number);
  if (field.type === "ref") return referenceNames.value[field.key] || value;
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.key === "status") return statusText[String(value)] || value;
  return value;
}
async function viewHistory(row: Row) {
  await openDetail(row);
  history.value = await api(`/catalog/${kind.value}/history/${row.id}`);
}
watch(kind, () => {
  page.value = 1;
  load();
});
watch(
  () => props.kinds,
  () => {
    kind.value = props.kinds[0]!;
  },
);
onMounted(async () => {
  definitions.value = await api("/catalogs");
  await load();
});
</script>
<template>
  <template v-if="!detail">
    <div class="page-heading">
      <div>
        <div class="section-caption">Master data</div>
        <h1>{{ title }}</h1>
        <p>统一维护业务定义，正式变更保留版本与关联历史。</p>
      </div>
      <ElButton
        :disabled="!can(catalogPermission)"
        type="primary"
        @click="edit()"
        >新增{{ definitions[kind]?.title }}</ElButton
      >
    </div>
    <ElTabs v-model="kind"
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
          placeholder="搜索编码或名称"
          @change="
            page = 1;
            load();
          "
        /><ElCheckbox v-model="deleted" @change="load">包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton
        ><span class="muted">共 {{ total }} 项</span>
      </div>
      <ElTable
        :data="rows"
        v-loading="loading"
        @selection-change="selected = $event"
        ><ElTableColumn type="selection" width="42" /><ElTableColumn
          label="编码 / 名称"
          min-width="190"
          ><template #default="{ row }"
            ><strong>{{
              row.name ||
              row.title ||
              row.tower_no ||
              row.tower_code ||
              row.line_code
            }}</strong>
            <div class="muted">
              {{
                row.code || row.logical_code || row.line_code || row.tower_code
              }}
            </div></template
          ></ElTableColumn
        ><ElTableColumn label="状态" width="100"
          ><template #default="{ row }"
            ><ElTag
              :type="
                row.deleted
                  ? 'danger'
                  : row.status === 'active'
                    ? 'success'
                    : 'info'
              "
              >{{
                row.deleted ? "已删除" : statusText[row.status] || row.status
              }}</ElTag
            ></template
          ></ElTableColumn
        ><ElTableColumn label="版本" width="75"
          ><template #default="{ row }">{{
            row.version_no || row.version || 1
          }}</template></ElTableColumn
        ><ElTableColumn label="操作" min-width="210"
          ><template #default="{ row }"
            ><ElButton size="small" @click="openDetail(row)">查看</ElButton
            ><ElButton
              size="small"
              :disabled="!can(catalogPermission) || row.deleted"
              @click="edit(row)"
              >编辑</ElButton
            ><ElButton
              v-if="row.deleted && definitions[kind]?.equipment"
              :disabled="!can('admin')"
              size="small"
              @click="edit(row, true)"
              >更正历史定义</ElButton
            ><ElButton size="small" @click="viewHistory(row)">历史</ElButton
            ><ElButton
              size="small"
              type="danger"
              :disabled="!can('admin') || row.deleted"
              @click="remove(row)"
              >删除</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      >
      <ElPagination
        v-model:current-page="page"
        :page-size="30"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
  </template>
  <template v-else
    ><div class="detail-header">
      <ElButton
        @click="
          detail = null;
          history = null;
        "
        >返回列表</ElButton
      >
      <h1>
        {{
          detail.name ||
          detail.title ||
          detail.tower_no ||
          detail.tower_code ||
          definitions[kind].title
        }}
      </h1>
      <ElTag>{{
        detail.deleted ? "已删除" : statusText[detail.status] || detail.status
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
      <ElDescriptions :column="2" border
        ><ElDescriptionsItem
          v-for="field in fields()"
          :key="field.key"
          :label="field.label"
          :span="field.type === 'json' ? 2 : 1"
        >
          <pre v-if="field.type === 'json'" class="data-json">{{
            detail[field.key]
          }}</pre>
          <span v-else>{{
            display(field, detail[field.key])
          }}</span></ElDescriptionsItem
        ></ElDescriptions
      >
    </div>
    <div v-if="history" class="panel">
      <h2>完整版本与审计历史</h2>
      <pre class="data-json">{{ JSON.stringify(history, null, 2) }}</pre>
    </div></template
  >
  <ElDialog
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (definitions[kind]?.title || '')"
    width="800px"
    :close-on-click-modal="false"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-model="tab"
        ><ElTabPane label="基本定义" name="basic" /><ElTabPane
          v-if="kind === 'operations'"
          label="录入模板"
          name="template" /><ElTabPane
          v-if="kind === 'operations'"
          label="附加字段"
          name="extra" /><ElTabPane label="影响与预览" name="impact"
      /></ElTabs>
      <ElAlert
        v-if="tab === 'impact'"
        title="提交会生成新定义版本。已签署需求、批准范围、费用与结算继续引用原正式版本。"
        type="info"
        :closable="false"
      />
      <div class="form-grid">
        <ElFormItem
          v-for="f in fields()"
          v-show="group(f) === tab && visible(f)"
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
      <ExtraFieldsEditor
        v-if="kind === 'operations' && tab === 'extra'"
        :operation="form"
      />
      <FactorDefinitionEditor
        v-if="kind === 'factors' && tab === 'basic'"
        :factor="form"
      />
      <PriceConditionsEditor
        v-if="kind === 'prices' && tab === 'basic'"
        :rule="form"
      />
      <OperationFeaturesEditor
        v-if="kind === 'operations' && tab === 'extra'"
        :operation="form"
      />
      <PricingModelEditor
        v-if="kind === 'prices' && tab === 'basic'"
        :rule="form"
      /> </ElForm
    ><template #footer
      ><ElButton @click="dialog = false">取消</ElButton
      ><ElButton
        :disabled="!can(catalogPermission)"
        type="primary"
        :loading="loading"
        @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
