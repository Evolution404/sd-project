<template>
  <section v-if="open" :aria-label="title" data-guide-workspace class="page-container">
    <el-card class="page-content" shadow="never">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <div class="page-heading-actions">
            <el-button :disabled="busy" @click="close()">{{ readonly ? "关闭" : "取消" }}</el-button>
            <el-button v-if="!readonly" type="primary" :loading="saving" :disabled="loading || checking || Boolean(loadError)"
              data-guide-action="pricing.save" @click="save">保存正式规则</el-button>
          </div>
        </div>
      </template>
    <el-skeleton v-if="loading" animated :rows="8" />
    <el-alert v-else-if="loadError" type="error" :title="loadError" :closable="false">
      <el-button link type="primary" @click="load">重新加载</el-button>
    </el-alert>
    <template v-else>
      <el-tabs v-model="tab">
        <el-tab-pane label="基本信息" name="basic" />
        <el-tab-pane name="conditions"><template #label><span data-guide-action="pricing.condition">适用条件</span></template></el-tab-pane>
        <el-tab-pane label="计价方式" name="formula" />
      </el-tabs>
      <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3" />
      <PriceRuleMainWorksheet v-if="!readonly" v-show="tab === 'basic'" ref="mainWorksheet"
        v-model="form" :voltages="voltages" :materials="materials" :disabled="busy" />
      <el-form novalidate :model="form" :disabled="readonly || busy" label-position="top">
        <el-row v-if="tab === 'basic'" :gutter="16" class="mt-3">
          <el-col v-if="readonly" :span="12">
            <el-form-item label="规则名称" required><el-input v-model="form.title" /></el-form-item>
          </el-col>
          <el-col v-if="readonly" :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status"><el-radio value="active">启用</el-radio><el-radio data-guide-action="pricing.retire" value="inactive">停用</el-radio></el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="操作类型" required>
              <el-select v-model="form.operation_id" filterable>
                <el-option v-for="choice in operations" :key="choice.id" :value="choice.id" :label="choice.name" />
                <el-option v-if="record && !operations.some(choice => choice.id === record?.operation_id)"
                  :value="record.operation_id" :label="record.operation_id_label" disabled />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="正式定义">
              <el-space v-if="definition" wrap><span>操作版本：V{{ definition.version }}</span><span>计量单位：{{ definition.default_unit_id_label }}</span><span>单位版本：V{{ definition.default_unit_version }}</span></el-space>
              <el-checkbox v-if="record && record.operation_id === form.operation_id && !readonly"
                v-model="form.adoptLatest">采用当前正式操作版本</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col v-if="readonly" :span="12"><el-form-item label="价格来源" required><el-input v-model="form.price_source" /></el-form-item></el-col>
          <el-col v-if="readonly" :span="12"><el-form-item label="修订理由"><el-input v-model="form.reason" /></el-form-item></el-col>
          <el-col v-if="readonly" :span="12"><el-form-item label="价格日期" required><el-date-picker v-model="form.price_date" type="date" value-format="YYYY-MM-DD" /></el-form-item></el-col>
          <el-col v-if="readonly" :span="12"><el-form-item label="生效日期" required><el-date-picker v-model="form.effective_on" type="date" value-format="YYYY-MM-DD" /></el-form-item></el-col>
          <el-col v-if="readonly" :span="24"><el-form-item label="计价依据" required><el-input v-model="form.basis" type="textarea" /></el-form-item></el-col>
        </el-row>
        <template v-else-if="tab === 'conditions'">
          <el-row v-if="readonly" :gutter="16">
            <el-col :span="12">
              <el-form-item label="适用电压等级">
                <el-select v-model="form.voltage_level_id" clearable filterable>
                  <el-option v-for="choice in voltages" :key="choice.value" :value="choice.value" :label="choice.label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="适用杆塔材质">
                <el-select v-model="form.tower_material" clearable filterable>
                  <el-option v-for="choice in materials" :key="choice.value" :value="choice.value" :label="choice.label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="作业方式">
                <el-select v-model="form.work_mode">
                  <el-option label="不限" value="both" /><el-option label="停电" value="outage" />
                  <el-option label="不停电" value="non_outage" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12"><el-form-item label="适用规格"><el-input v-model="form.specification" /></el-form-item></el-col>
          </el-row>
          <el-alert v-if="definitionError" :title="definitionError" :closable="false" type="error" />
          <el-alert v-else-if="loadingDefinition" title="正在读取所采用的正式操作定义" :closable="false" type="info" />
          <el-table v-if="readonly && definition" :data="historicalConditions" border empty-text="未采用附加计价条件">
            <el-table-column label="计价属性" prop="label" min-width="130" />
            <el-table-column label="匹配方式" prop="operation" width="135" />
            <el-table-column label="适用取值" prop="value" min-width="150" />
            <el-table-column label="最小值" prop="min" min-width="130" />
            <el-table-column label="最大值" prop="max" min-width="130" />
          </el-table>
        </template>
        <template v-else>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="计价模型" required>
                <el-select v-model="form.formula.mode">
                  <el-option v-for="model in modelOptions" :key="model.value" :value="model.value" :label="model.label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="计价作用域" required>
                <el-select v-model="form.pricing_scope">
                  <el-option label="每作业位置" value="work_location" /><el-option label="每批作业" value="work_batch" />
                  <el-option label="每项目" value="project" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <PriceFormulaFields v-model="form.formula" :scope="form.pricing_scope" :readonly="readonly" />
          <template v-if="form.formula.mode === 'composite'">
            <el-card v-for="(component, index) in form.components" :key="index" class="mb-2" shadow="never">
              <el-row :gutter="16">
                <el-col :span="12"><el-form-item label="费用覆盖名称" required><el-input v-model="component.name" /></el-form-item></el-col>
                <el-col :span="12">
                  <el-form-item label="费用模型" required>
                    <el-select v-model="component.formula.mode">
                      <el-option v-for="model in componentModels" :key="model.value" :value="model.value" :label="model.label" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <PriceFormulaFields v-model="component.formula" :scope="form.pricing_scope" :readonly="readonly" />
              <el-button v-if="!readonly" link type="danger" data-guide-action="pricing.model-remove" @click="form.components.splice(index, 1)">移除费用组成</el-button>
            </el-card>
            <el-button v-if="!readonly" @click="form.components.push({ name: '', formula: readFormula() })">增加费用组成</el-button>
          </template>
        </template>
      </el-form>
      <PriceConditionsWorksheet v-if="!readonly && conditionsOpened && definition"
        v-show="tab === 'conditions'" :key="definition.operation_id + ':' + definition.version" ref="conditionsWorksheet"
        v-model="form.conditions" :features="features" :choices="choices" :disabled="busy" />
      <template v-if="tab === 'formula' && !readonly">
        <el-divider>试算</el-divider>
        <el-form :disabled="busy" novalidate label-position="top">
          <el-row :gutter="16">
            <el-col :span="12"><el-form-item label="试算数量"><el-input v-model="sampleQuantity" inputmode="decimal" /></el-form-item></el-col>
            <el-col v-for="rate in requiredBases" :key="rate.value" :span="12">
              <el-form-item :label="'试算' + rate.label + '（元）'">
                <el-input v-model="sampleBases[rate.value]" inputmode="decimal" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-button data-guide-action="pricing.preview" :loading="checking" @click="runPreview">校验并试算</el-button>
        </el-form>
        <template v-if="preview">
          <el-alert v-if="preview.sample" class="mt-3" type="success" :closable="false"
            :title="'试算金额 ¥' + fenToYuan(preview.sample.amount_fen)" />
          <el-alert v-else-if="preview.sample_error" class="mt-3" type="warning" :closable="false" :title="preview.sample_error" />
          <el-alert v-if="preview.warning" class="mt-2" type="warning" :closable="false"
            :title="preview.warning + '。相关规则 ' + preview.overlaps.map(rule => rule.title).join('、')" />
        </template>
      </template>
    </template>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { PriceRulePreview } from "../../../../server/shared/types/price-rules";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { OperationRecord } from "../../../../server/shared/types/work-standards";
import type { OptionItem } from "@/api/common";
import { readOperationDefinition, type WorkStandardRow } from "@/api/business/standards";
import { fenToYuan } from "@/api/business/funding";
import { getPrice, loadPriceForm, previewPrice, savePrice, type PriceRule } from "@/api/business/pricing";
import { modelOptions, rateBases, readFormula } from "@/api/business/price-formula";
import PriceFormulaFields from "./PriceFormulaFields.vue";
import PriceRuleMainWorksheet from "./PriceRuleMainWorksheet.vue";
import PriceConditionsWorksheet from "./PriceConditionsWorksheet.vue";

const props = defineProps<{ id?: string; readonly: boolean; operations: WorkStandardRow[];
  voltages: OptionItem[]; materials: OptionItem[]; natures: OptionItem[] }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();
const title = computed(() => props.readonly ? "查看参考价格规则" : props.id ? "修订参考价格规则" : "新增参考价格规则");
const record = ref<PriceRule>();
const form = ref(loadPriceForm());
const tab = ref("basic");
const mainWorksheet = ref<InstanceType<typeof PriceRuleMainWorksheet>>();
const conditionsWorksheet = ref<InstanceType<typeof PriceConditionsWorksheet>>();
const conditionsOpened = ref(false);
watch(tab, value => { if (value === "conditions") conditionsOpened.value = true; });
const error = ref(""), loadError = ref(""), definitionError = ref("");
const loading = ref(false), saving = ref(false), checking = ref(false), loadingDefinition = ref(false);
const busy = computed(() => saving.value || checking.value);
const definition = ref<OperationRecord>();
const preview = ref<PriceRulePreview>();
const sampleQuantity = ref("1"), sampleBases = ref<Record<string, string>>({});
const componentModels = modelOptions.filter(row => row.value !== "composite");
const features = computed<OperationAttribute[]>(() => (JSON.parse(definition.value?.attributes_schema_json || "[]") as OperationAttribute[])
  .filter(field => field.enabled && field.pricing));
const historicalConditions = computed(() => Object.entries(form.value.conditions).map(([key, value]) => {
  const field = features.value.find(item => item.key === key);
  const display = typeof value.value === "boolean" ? value.value ? "是" : "否" : value.value;
  return { label: field?.label || "历史属性", operation: value.op === "eq" ? "精确匹配" : "范围匹配",
    value: field?.type === "select" ? choices(field).find(item => item.value === value.value)?.label || "已采用正式选项" : display,
    min: value.min, max: value.max };
}));
const obsoleteConditions = computed(() => Object.keys(form.value.conditions).filter(key => !features.value.some(field => field.key === key)));
const requiredBases = computed(() => {
  const models = form.value.formula.mode === "composite" ? form.value.components.map(component => component.formula) : [form.value.formula];
  return rateBases.filter(basis => models.some(model => model.mode === "rate" && model.rateBasis === basis.value));
});
let baseline = "";
let sequence = 0;
let definitionSequence = 0;

function choices(field: OperationAttribute): OptionItem[] {
  if (field.type !== "select") return [];
  if (field.source === "manual") return field.options;
  return field.asset_field === "voltage_level_id" ? props.voltages
    : field.asset_field === "tower_material" ? props.materials : props.natures;
}
async function load() {
  const request = ++sequence;
  loading.value = Boolean(props.id);
  error.value = "";
  loadError.value = "";
  tab.value = "basic";
  conditionsOpened.value = false;
  record.value = undefined;
  preview.value = undefined;
  baseline = "";
  sampleQuantity.value = "1";
  sampleBases.value = {};
  try {
    const current = props.id ? await getPrice(props.id,props.readonly) : undefined;
    if (request !== sequence) return;
    record.value = current;
    form.value = loadPriceForm(current);
    baseline = JSON.stringify(form.value);
  } catch (cause) {
    if (request === sequence) loadError.value = (cause as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}
async function loadDefinition() {
  const token = ++definitionSequence;
  definition.value = undefined;
  definitionError.value = "";
  loadingDefinition.value = false;
  const id = form.value.operation_id;
  if (!open.value || loading.value || !id) return;
  const adopted = record.value?.operation_id === id && !form.value.adoptLatest ? record.value.operation_version : undefined;
  loadingDefinition.value = true;
  try {
    const row = await readOperationDefinition(id, adopted);
    if (token === definitionSequence) definition.value = row;
  } catch (cause) {
    if (token === definitionSequence) definitionError.value = (cause as Error).message;
  } finally {
    if (token === definitionSequence) loadingDefinition.value = false;
  }
}
async function validate() {
  if (mainWorksheet.value && !await mainWorksheet.value.prepare()) {
    tab.value = "basic";
    throw Error("请修正主规则工作表");
  }
  if (conditionsWorksheet.value && !await conditionsWorksheet.value.prepare()) {
    tab.value = "conditions";
    throw Error("请修正计价条件工作表");
  }
  if (!form.value.title.trim() || !form.value.operation_id || !form.value.price_source.trim() ||
    !form.value.price_date || !form.value.effective_on || !form.value.basis.trim()) {
    tab.value = "basic";
    throw Error("请填写规则名称、操作类型、价格来源、价格日期、生效日期和依据");
  }
  if (loadingDefinition.value || !definition.value) {
    tab.value = "conditions";
    throw Error(definitionError.value || "请等待正式操作定义加载完成");
  }
  if (obsoleteConditions.value.length) {
    tab.value = "conditions";
    throw Error("请移除已不适用的原条件");
  }
}
async function save() {
  if (busy.value || props.readonly) return;
  saving.value = true;
  error.value = "";
  try {
    await validate();
    await savePrice(form.value, record.value);
    open.value = false;
    emit("saved");
    ElMessage.success("参考价格正式版本已保存");
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}
async function runPreview() {
  if (busy.value || props.readonly) return;
  checking.value = true;
  error.value = "";
  preview.value = undefined;
  try {
    await validate();
    preview.value = await previewPrice(form.value, sampleQuantity.value, sampleBases.value, record.value);
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    checking.value = false;
  }
}
function dirty() {
  return open.value && !props.readonly && Boolean(baseline) && (baseline !== JSON.stringify(form.value) || mainWorksheet.value?.changed() || conditionsWorksheet.value?.changed());
}
async function allowClose() {
  if (busy.value) return false;
  await mainWorksheet.value?.finishEditing();
  await conditionsWorksheet.value?.finishEditing();
  if (!dirty()) return true;
  try {
    await ElMessageBox.confirm("规则尚未保存，确定放弃？", "放弃参考价格修改", {
      type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续填写",
    });
    return true;
  } catch {
    return false;
  }
}
async function close() {
  if (await allowClose()) open.value = false;
}
watch(open, active => { if (active) void load(); else sequence++; });
watch(() => [open.value, loading.value, form.value.operation_id, form.value.adoptLatest], loadDefinition);
watch([form, sampleQuantity, sampleBases], () => { preview.value = undefined; }, { deep: true });
onBeforeRouteLeave(allowClose);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty() || busy.value) event.preventDefault();
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
