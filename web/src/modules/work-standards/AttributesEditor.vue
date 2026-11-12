<script setup lang="ts">
import { newClientId } from "../../shared/utils/id";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type {
  OperationAttribute,
  AttributeValues,
} from "../../../../server/shared/types/operation-attributes";
import { api } from "../../shared/api/client";
import BusinessTable from "../../shared/ui/BusinessTable.vue";
import FieldControl from "../../shared/ui/FieldControl.vue";
import AttributeFields from "../../shared/ui/AttributeFields.vue";
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const fields = computed<OperationAttribute[]>(() =>
  JSON.parse(props.modelValue || "[]"),
);
const editing = ref<OperationAttribute | null>(null);
const index = ref(-1);
const types = {
  text: "文字",
  textarea: "长文字",
  integer: "整数",
  decimal: "小数",
  select: "单选",
  multiselect: "多选",
  boolean: "是否",
  date: "日期",
};
const columns = [
  { key: "label", label: "属性名称" },
  { key: "scope", label: "所属层级" },
  { key: "type", label: "字段类型" },
  { key: "requirement", label: "必填规则" },
  { key: "pricing", label: "参与计价" },
  { key: "enabled", label: "启用" },
];
function edit(field?: OperationAttribute, position = -1) {
  index.value = position;
  editing.value = field
    ? JSON.parse(JSON.stringify(field))
    : {
        key: newClientId(),
        label: "",
        type: "text",
        scope: "location",
        source: "manual",
        requirement: "optional",
        pricing: false,
        enabled: true,
        sort_order: fields.value.length + 1,
        hint: "",
      };

}
function changeType(type: OperationAttribute["type"]) {
  if (!editing.value) return;
  const { key, label, scope, source, requirement, enabled, sort_order, hint } =
    editing.value;
  const common = {
    key,
    label,
    scope,
    source,
    requirement,
    enabled,
    sort_order,
    hint,
    pricing: false,
  };
  editing.value =
    type === "select" || type === "multiselect"
      ? { ...common, type, options: [] }
      : type === "integer" || type === "decimal"
        ? { ...common, type, precision: type === "integer" ? 0 : 2 }
        : { ...common, type };
}
function changeSource(source: "manual" | "asset") {
  if (!editing.value) return;
  editing.value.source = source;
  if (source === "asset") {
    changeType("select");
    editing.value.scope = "location";
  } else delete editing.value.asset_field;
}
async function chooseUnit(value: unknown) {
  if (
    !editing.value ||
    !(editing.value.type === "integer" || editing.value.type === "decimal")
  )
    return;
  if (!value) {
    delete editing.value.unit_id;
    delete editing.value.unit_version;
    return;
  }
  try {
    const unit = await api<{
      id: string;
      version: number;
      quantity_precision: 0 | 1 | 2 | 3 | 4;
    }>("/catalog/units/" + value);
    editing.value.unit_id = unit.id;
    editing.value.unit_version = unit.version;
    editing.value.precision = unit.quantity_precision;
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  }
}
const defaults = computed<AttributeValues>({
  get: () =>
    editing.value?.default_value === undefined
      ? {}
      : { [editing.value.key]: editing.value.default_value },
  set: (values) => {
    if (editing.value) editing.value.default_value = values[editing.value.key];
  },
});
function save() {
  if (!editing.value) return;
  const field = editing.value;
  const next = [...fields.value];
  if (index.value < 0) next.push(field);
  else next[index.value] = field;
  emit("update:modelValue", JSON.stringify(next));
  editing.value = null;
}
</script>
<template>
  <BusinessTable
    :rows="fields"
    :columns="columns"
    table-key="operation:attributes"
    client-side
    :actions-width="100"
  >
    <template #cell="{ row, column }">
      <span v-if="column.key === 'scope'">{{
        row.scope === "demand" ? "需求级" : "位置级"
      }}</span>
      <span v-else-if="column.key === 'type'">{{ types[row.type] }}</span>
      <span v-else-if="column.key === 'requirement'">{{
        { optional: "可选", save: "保存必填", pricing: "计价必需" }[
          row.requirement
        ]
      }}</span>
      <span v-else-if="column.key === 'pricing' || column.key === 'enabled'">{{
        row[column.key] ? "是" : "否"
      }}</span>
      <span v-else>{{ row.label }}</span>
    </template>
    <template #actions="{ row }"
      ><ElButton data-guide-action="standards.attribute-edit"
        size="small"
        @click="
          edit(
            row,
            fields.findIndex((item) => item.key === row.key),
          )
        "
        >编辑</ElButton
      ></template
    >
  </BusinessTable>
  <ElButton data-guide-action="standards.attribute" data-action="add-operation-attribute" @click="edit()"
    >添加附加属性</ElButton
  >
  <ElDialog
    :model-value="!!editing"
    title="附加属性"
    append-to-body
    width="min(780px,94vw)"
    @close="editing = null"
  >
    <ElForm v-if="editing" label-position="top" novalidate>
      <div class="form-grid">
        <ElFormItem label="属性名称" required
          ><ElInput v-model="editing.label"
        /></ElFormItem>
        <ElFormItem label="所属层级"
          ><ElSelect v-model="editing.scope"
            ><ElOption label="需求级" value="demand" /><ElOption
              label="位置级"
              value="location" /></ElSelect
        ></ElFormItem>
        <ElFormItem label="数据来源"
          ><ElSelect :model-value="editing.source" @update:model-value="changeSource"
            ><ElOption label="手工录入" value="manual" /><ElOption
              label="引用设备台账"
              value="asset" /></ElSelect
        ></ElFormItem>
        <ElFormItem label="字段类型"
          ><ElSelect
            :model-value="editing.type"
            @update:model-value="changeType"
            ><ElOption
              v-for="(label, key) in types"
              :key="key"
              :label="label"
              :value="key" /></ElSelect
        ></ElFormItem>
        <ElFormItem v-if="editing.source === 'asset'" label="台账字段"
          ><ElSelect v-model="editing.asset_field"
            ><ElOption label="电压等级" value="voltage_level_id" /><ElOption
              label="塔型"
              value="tower_material" /><ElOption
              label="杆塔性质"
              value="tower_nature" /></ElSelect
        ></ElFormItem>
        <ElFormItem label="必填规则"
          ><ElSelect v-model="editing.requirement"
            ><ElOption label="可选" value="optional" /><ElOption
              label="保存必填"
              value="save" /><ElOption
              label="计价必需"
              value="pricing" /></ElSelect
        ></ElFormItem>
        <ElFormItem label="是否参与计价"
          ><ElSwitch
            v-model="editing.pricing"
            :disabled="
              !['select', 'boolean', 'integer', 'decimal'].includes(
                editing.type,
              )
            "
        /></ElFormItem>
        <template
          v-if="editing.type === 'integer' || editing.type === 'decimal'"
        >
          <ElFormItem label="计量单位（可选）"
            ><FieldControl
              :model-value="editing.unit_id"
              :field="{ type: 'ref', reference: 'units' }"
              @update:model-value="chooseUnit"
          /></ElFormItem>
          <ElFormItem label="数值精度"
            ><ElInputNumber
              v-model="editing.precision"
              :min="0"
              :max="editing.type === 'integer' ? 0 : 4"
              :disabled="!!editing.unit_id"
              :precision="0"
          /></ElFormItem>
          <ElFormItem label="最小值"
            ><ElInput v-model="editing.min" /></ElFormItem
          ><ElFormItem label="最大值"
            ><ElInput v-model="editing.max"
          /></ElFormItem>
        </template>
        <div v-if="'options' in editing && editing.source === 'manual'" class="full-width">
          <ElFormItem v-for="(option, position) in editing.options" :key="option.value" :label="`选项名称 ${position + 1}`">
            <ElInput v-model="option.label" />
            <ElButton data-guide-action="standards.option-remove" @click="editing.options.splice(position, 1)">移除选项</ElButton>
          </ElFormItem>
          <ElButton data-guide-action="standards.option-add" @click="editing.options.push({ value: newClientId(), label: '' })">添加选项</ElButton>
        </div>
        <ElFormItem label="录入提示"
          ><ElInput v-model="editing.hint"
        /></ElFormItem>
        <ElFormItem label="排序"
          ><ElInputNumber v-model="editing.sort_order" :precision="0"
        /></ElFormItem>
        <ElFormItem label="启用"
          ><ElSwitch v-model="editing.enabled"
        /></ElFormItem>
      </div>
      <ElCollapse v-if="editing.source === 'manual'"
        ><ElCollapseItem title="默认值（可选，创建时可核对修改）"
          ><AttributeFields
            v-model="defaults"
            :definitions="[editing]"
            :scope="editing.scope"
            defaults /></ElCollapseItem
      ></ElCollapse>
      <p class="muted">属性身份 {{ editing.key }}</p>
    </ElForm>
    <template #footer
      ><ElButton @click="editing = null">取消</ElButton
      ><ElButton data-guide-action="standards.attribute-save" type="primary" @click="save">保存属性配置</ElButton></template
    >
  </ElDialog>
</template>
