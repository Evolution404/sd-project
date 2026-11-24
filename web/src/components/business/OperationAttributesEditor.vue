<template>
  <el-table :data="fields" row-key="key" border>
    <el-table-column label="名称" prop="label" min-width="150" />
    <el-table-column label="层级" width="95">
      <template #default="{ row }">{{ row.scope === "demand" ? "需求级" : "位置级" }}</template>
    </el-table-column>
    <el-table-column label="类型" width="95">
      <template #default="{ row }">{{ typeNames[row.type as OperationAttribute["type"]] }}</template>
    </el-table-column>
    <el-table-column label="参与计价" width="100">
      <template #default="{ row }">{{ row.pricing ? "是" : "否" }}</template>
    </el-table-column>
    <el-table-column label="状态" width="90">
      <template #default="{ row }">{{ row.enabled ? "启用" : "停用" }}</template>
    </el-table-column>
    <el-table-column v-if="!readonly" label="操作" width="105" fixed="right">
      <template #default="{ row }">
        <el-button link type="primary" data-guide-action="standards.attribute-edit" @click="edit(row as OperationAttribute)">编辑属性</el-button>
      </template>
    </el-table-column>
  </el-table>
  <el-button v-if="!readonly" class="mt-3" data-guide-action="standards.attribute" @click="edit()">添加附加属性</el-button>
  <el-dialog v-model="open" title="配置附加属性" width="min(94vw, 700px)" append-to-body
    destroy-on-close :close-on-click-modal="false" :before-close="close">
    <el-form v-if="editing" :model="editing" label-position="top" novalidate>
      <el-row :gutter="14">
        <el-col :span="12">
          <el-form-item label="属性名称" required><el-input v-model="editing.label" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数据来源">
            <el-select :model-value="editing.source" @update:model-value="changeSource">
              <el-option label="手工录入" value="manual" />
              <el-option label="引用设备台账" value="asset" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="层级">
            <el-select v-model="editing.scope" :disabled="editing.source === 'asset'">
              <el-option label="需求级" value="demand" /><el-option label="位置级" value="location" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="字段类型">
            <el-select :model-value="editing.type" :disabled="editing.source === 'asset'" @update:model-value="changeType">
              <el-option v-for="(label, key) in typeNames" :key="key" :value="key" :label="label" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="editing.source === 'asset'" :span="12">
          <el-form-item label="台账字段" required>
            <el-select v-model="editing.asset_field">
              <el-option label="电压等级" value="voltage_level_id" />
              <el-option label="杆塔材质" value="tower_material" />
              <el-option label="杆塔性质" value="tower_nature" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="必填规则">
            <el-select v-model="editing.requirement">
              <el-option label="可选" value="optional" />
              <el-option label="保存必填" value="save" />
              <el-option label="计价必需" value="pricing" :disabled="!editing.pricing" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="启用属性"><el-switch v-model="editing.enabled" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="参与计价">
            <el-switch v-model="editing.pricing" :disabled="!priceable" @change="updatePricing" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="排序"><el-input-number v-model="editing.sort_order" :precision="0" :min="1" /></el-form-item>
        </el-col>
        <el-col v-if="editing.type === 'integer' || editing.type === 'decimal'" :span="24">
          <div class="grid grid-cols-2 gap-x-3">
            <el-form-item label="数值单位">
              <el-select :model-value="editing.unit_id" filterable clearable @update:model-value="chooseUnit">
                <el-option v-for="unit in compatibleUnits" :key="unit.id" :value="unit.id" :label="unit.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="允许小数位">
              <el-input-number v-model="editing.precision" :disabled="Boolean(editing.unit_id) || editing.type === 'integer'"
                :precision="0" :min="0" :max="4" />
            </el-form-item>
            <el-form-item label="最小值"><el-input v-model="editing.min" inputmode="decimal" /></el-form-item>
            <el-form-item label="最大值"><el-input v-model="editing.max" inputmode="decimal" /></el-form-item>
          </div>
        </el-col>
        <el-col v-if="editing.source === 'manual' && (editing.type === 'select' || editing.type === 'multiselect')" :span="24">
          <el-form-item label="可选值">
            <div v-for="option in editing.options" :key="option.value" class="mb-2 flex w-full gap-2">
              <el-input v-model="option.label" aria-label="选项名称" />
              <el-button data-guide-action="standards.option-remove" @click="removeOption(option.value)">移除</el-button>
            </div>
            <el-button data-guide-action="standards.option-add" @click="addOption">添加选项</el-button>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="填写提示"><el-input v-model="editing.hint" /></el-form-item>
        </el-col>
        <el-col v-if="editing.source === 'manual'" :span="24">
          <DemandAttributeFields v-model="defaults" :fields="[{ ...editing, label: '默认值' }]" />
        </el-col>
      </el-row>
    </el-form>
    <template #footer>
      <el-button @click="close()">取消</el-button>
      <el-button type="primary" data-guide-action="standards.attribute-save" @click="apply">应用属性</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { AttributeValues, OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { QuantityPrecision } from "../../../../server/shared/quantity-precision";
import type { DictionaryRow } from "@/api/business/dictionaries";
import { randomRequestId } from "@/utils/business/request-id";
import DemandAttributeFields from "./DemandAttributeFields.vue";

const props = defineProps<{ units: DictionaryRow[]; readonly: boolean }>();
const fields = defineModel<OperationAttribute[]>({ required: true });
const open = ref(false);
const editing = ref<OperationAttribute>();
let baseline = "";
const typeNames = {
  text: "文字", textarea: "长文字", integer: "整数", decimal: "小数",
  select: "单选", multiselect: "多选", boolean: "是否", date: "日期",
};
const supportsPricing = (type: OperationAttribute["type"]) => ["select", "boolean", "integer", "decimal"].includes(type);
const priceable = computed(() => editing.value && supportsPricing(editing.value.type));
const compatibleUnits = computed(() => props.units.filter(unit => editing.value?.type !== "integer" ||
  unit.quantity_precision === 0));
const defaults = computed<AttributeValues>({
  get: () => !editing.value || editing.value.default_value === undefined ? {} : {
    [editing.value.key]: editing.value.default_value,
  },
  set(values) {
    if (!editing.value) return;
    const value = values[editing.value.key];
    if (value === undefined) delete editing.value.default_value;
    else editing.value.default_value = value;
  },
});

function edit(field?: OperationAttribute) {
  editing.value = field ? JSON.parse(JSON.stringify(field)) : {
    key: randomRequestId(), label: "", type: "text", scope: "location", source: "manual",
    requirement: "optional", pricing: false, enabled: true, sort_order: fields.value.length + 1, hint: "",
  };
  baseline = JSON.stringify(editing.value);
  open.value = true;
}
function updatePricing() {
  if (editing.value && !editing.value.pricing && editing.value.requirement === "pricing")
    editing.value.requirement = "optional";
}
function changeType(type: OperationAttribute["type"]) {
  if (!editing.value || type === editing.value.type) return;
  const { key, label, source, scope, asset_field, requirement, pricing, enabled, sort_order, hint } = editing.value;
  const base = { key, label, source, scope, asset_field, requirement,
    pricing: pricing && supportsPricing(type), enabled, sort_order, hint };
  if (type === "integer" || type === "decimal") editing.value = { ...base, type, precision: type === "integer" ? 0 : 2 };
  else if (type === "select" || type === "multiselect") editing.value = { ...base, type, options: [] };
  else editing.value = { ...base, type };
  updatePricing();
}
function changeSource(source: OperationAttribute["source"]) {
  const field = editing.value;
  if (!field) return;
  field.source = source;
  if (source === "manual") {
    delete field.asset_field;
    return;
  }
  changeType("select");
  const asset = editing.value;
  if (asset?.type !== "select") return;
  asset.scope = "location";
  asset.options = [];
  delete asset.default_value;
}
function chooseUnit(id: string) {
  const field = editing.value;
  if (!field || (field.type !== "integer" && field.type !== "decimal")) return;
  const unit = compatibleUnits.value.find(row => row.id === id);
  if (unit && typeof unit.quantity_precision === "number") {
    field.unit_id = unit.id;
    field.unit_version = unit.version;
    field.precision = unit.quantity_precision as QuantityPrecision;
  } else {
    delete field.unit_id;
    delete field.unit_version;
  }
}
function addOption() {
  const field = editing.value;
  if (field?.type === "select" || field?.type === "multiselect") field.options.push({ value: randomRequestId(), label: "" });
}
function removeOption(id: string) {
  const field = editing.value;
  if (field?.type !== "select" && field?.type !== "multiselect") return;
  field.options = field.options.filter(option => option.value !== id);
  if (field.default_value === id) delete field.default_value;
  if (Array.isArray(field.default_value)) field.default_value = field.default_value.filter(value => value !== id);
}
async function allowClose() {
  if (!open.value || baseline === JSON.stringify(editing.value)) return true;
  try {
    await ElMessageBox.confirm("当前属性尚未应用，确定放弃？", "放弃属性修改", {
      type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续配置",
    });
    return true;
  } catch {
    return false;
  }
}
async function close(done?: () => void) {
  if (!(await allowClose())) return;
  if (done) done();
  else open.value = false;
}
function apply() {
  const field = editing.value;
  if (!field?.label.trim()) return ElMessage.warning("请填写属性名称");
  if (field.source === "asset" && !field.asset_field) return ElMessage.warning("请选择被引用的台账字段");
  if (field.source === "manual" && (field.type === "select" || field.type === "multiselect") &&
    (!field.options.length || field.options.some(option => !option.label.trim())))
    return ElMessage.warning("请完整填写属性可选值");
  if (field.type === "integer" || field.type === "decimal") {
    if (!field.min?.trim()) delete field.min;
    if (!field.max?.trim()) delete field.max;
  }
  const next = [...fields.value];
  const index = next.findIndex(row => row.key === field.key);
  if (index === -1) next.push(field);
  else next[index] = field;
  fields.value = next;
  open.value = false;
}

defineExpose({ allowClose });
</script>
