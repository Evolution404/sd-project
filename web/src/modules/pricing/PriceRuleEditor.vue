<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage, type FormInstance } from "element-plus";
import type {
  CatalogField,
  CatalogFormDefinition,
} from "../../../../server/shared/types/catalog";
import type {
  PriceRuleRecord,
  PriceRulePreview,
} from "../../../../server/shared/types/price-rules";
import type { OperationRecord, OperationVersion } from "../../../../server/shared/types/work-standards";
import { readAdoptedQuantityPrecision } from "../../shared/api/quantity-precision";
import type { FieldErrors } from "../../../../server/shared/types/contracts";
import { api, money, quantity } from "../../shared/api/client";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FieldControl from "../../shared/ui/FieldControl.vue";
import PriceConditionsEditor from "./PriceConditionsEditor.vue";
import PricingModelEditor from "./PricingModelEditor.vue";
interface PriceDraft extends Record<string, unknown> {
  pricing_mode?: string;
  operation_version?: number | null;
  adopt_latest_operation_version?: boolean;
  price_features_loading?: boolean;
  price_features_load_error?: string;
}
const props = defineProps<{
  open: boolean;
  editing: PriceRuleRecord | null;
  copy?: boolean;
  definition?: CatalogFormDefinition;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const fields = computed(() =>
  [
    ...(props.definition?.rootFields || []),
    ...(props.definition?.fields || []),
  ].filter((field) => !field.systemManaged),
);
const form = ref<PriceDraft>({}),
  formRef = ref<FormInstance>(),
  errors = ref<FieldErrors>({}),
  saving = ref(false),
  tab = ref("basic"),
  latestVersion = ref<number | null>(null),
  check = ref<PriceRulePreview | null>(null),
  checkError = ref(""),
  checking = ref(false),
  checkPanel = ref<HTMLElement | null>(null),
  sampleQuantity = ref(10000),
  pricingQuantityPrecision = ref<number | undefined>(),
  pricingPrecisionError = ref(""),
  sampleQuantityInvalid = ref(false),
  pricingInputsInvalid = ref(false);
let precisionRequest = 0;
const guard = useDialogDraftGuard(() => form.value);
const existing = computed(() => (props.copy ? null : props.editing));
watch(
  () => [props.open, form.value.operation_id, form.value.operation_version, latestVersion.value] as const,
  async ([open, operationId, chosenVersion, latest]) => {
    const seq = ++precisionRequest;
    pricingQuantityPrecision.value = undefined;
    pricingPrecisionError.value = "";
    if (!open || typeof operationId !== "string" || !operationId) return;
    const version = chosenVersion ?? latest;
    if (!Number.isSafeInteger(version) || Number(version) < 1) return;
    try {
      const history = await api<OperationVersion[]>(
        "/catalog/operations/history/" + encodeURIComponent(operationId),
      );
      const adopted = history.find(item => item.version === version);
      if (!adopted) throw Error("采用的操作定义正式版本不存在");
      const precision = await readAdoptedQuantityPrecision(
        adopted.default_unit_id, adopted.default_unit_version);
      if (seq === precisionRequest) pricingQuantityPrecision.value = precision;
    } catch (failure) {
      if (seq === precisionRequest)
        pricingPrecisionError.value = (failure as Error).message;
    }
  },
  { immediate: true },
);
let versionRequest = 0;
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    form.value = {};
    errors.value = {};
    tab.value = "basic";
    check.value = null;
    checkError.value = "";
    latestVersion.value = null;
    sampleQuantity.value = 10000;
    sampleQuantityInvalid.value = false;
    pricingInputsInvalid.value = false;
    for (const field of fields.value) {
      const value = props.editing
        ? (props.editing as unknown as Record<string, unknown>)[field.key]
        : undefined;
      const initial =
        value ??
        field.default ??
        (field.type === "text" && !field.nullable ? "" : null);
      form.value[field.key] =
        field.type === "json"
          ? typeof initial === "string"
            ? initial
            : JSON.stringify(initial)
          : initial;
    }
    if (props.copy)
      form.value.title = String(props.editing?.title || "") + "（副本）";
    form.value.operation_version = existing.value?.operation_version ?? null;
    form.value.adopt_latest_operation_version = false;
    void loadLatest();
    guard.capture();
  },
);
async function loadLatest() {
  const request = ++versionRequest,
    id = form.value.operation_id;
  latestVersion.value = null;
  if (!id) return;
  try {
    const operation = await api<OperationRecord>("/catalog/operations/" + id);
    if (request === versionRequest && form.value.operation_id === id)
      latestVersion.value = operation.version;
  } catch {
    if (request === versionRequest) latestVersion.value = null;
  }
}
function changed(key: string) {
  check.value = null;
  checkError.value = "";
  if (key === "operation_id") {
    form.value.operation_version = null;
    form.value.adopt_latest_operation_version = false;
    void loadLatest();
  }
}
function adoptLatest() {
  if (latestVersion.value) {
    form.value.adopt_latest_operation_version = true;
    form.value.operation_version = latestVersion.value;
    check.value = null;
  }
}
function group(field: CatalogField) {
  if (
    [
      "voltage_level_id",
      "tower_material",
      "work_mode",
      "specification",
      "additional_conditions_json",
    ].includes(field.key)
  )
    return "conditions";
  if (
    [
      "pricing_scope",
      "pricing_mode",
      "base_fee_fen",
      "unit_price_fen",
      "quantity_brackets_json",
      "calculation_params_json",
      "fee_components_json",
    ].includes(field.key)
  )
    return "pricing";
  return "basic";
}
function visible(field: CatalogField) {
  if (field.type === "json") return false;
  if (field.key === "base_fee_fen")
    return form.value.pricing_mode === "base_plus_unit";
  if (field.key === "unit_price_fen")
    return ["fixed", "per_unit", "base_plus_unit"].includes(
      form.value.pricing_mode || "",
    );
  return true;
}
async function preview() {
  if (checking.value) return;
  if (pricingQuantityPrecision.value === undefined ||
      sampleQuantityInvalid.value || pricingInputsInvalid.value) {
    ElMessage.error(pricingPrecisionError.value || "正式单位精度未确认或数量输入无效，请核对后再试算");
    return;
  }
  checking.value = true;
  check.value = null;
  checkError.value = "";
  try {
    if (
      form.value.price_features_load_error ||
      form.value.price_features_loading
    )
      throw new Error(
        form.value.price_features_load_error || "请先完成价格特征加载",
      );
    check.value = await api<PriceRulePreview>(
      "/catalog/prices/preview",
      "POST",
      {
        ...form.value,
        sample_quantity_scaled: sampleQuantity.value,
        existing_id: existing.value?.id,
      },
    );
  } catch (failure) {
    checkError.value = (failure as Error).message;
  } finally {
    checking.value = false;
    await nextTick();
    checkPanel.value?.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}
function close(done?: () => void) {
  void guard.confirmClose(() => {
    emit("update:open", false);
    done?.();
  });
}
async function focusError() {
  const invalid = formRef.value?.fields.find(
    (field) => field.validateState === "error",
  );
  const field = fields.value.find(
    (field) => field.key === invalid?.prop || errors.value[field.key],
  );
  if (field) tab.value = group(field);
  await nextTick();
  (formRef.value?.$el as HTMLElement | undefined)
    ?.querySelector<HTMLElement>(".el-form-item.is-error input")
    ?.focus();
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      await focusError();
      return;
    }
    // Report missing required business fields in their own tab first.
    // Once the form is complete, a missing frozen unit or invalid quantity
    // still prevents every formal preview and write.
    if (pricingQuantityPrecision.value === undefined ||
        sampleQuantityInvalid.value || pricingInputsInvalid.value) {
      throw new Error(pricingPrecisionError.value ||
        "正式单位精度未确认或存在无效数量，不能保存规则");
    }
    await preview();
    if (!check.value?.valid)
      throw new Error(checkError.value || "价格规则预检查未通过");
    const saved = await api<PriceRuleRecord & { warnings?: string[] }>(
      "/catalog/prices" + (existing.value ? "/" + existing.value.id : ""),
      "POST",
      {
        ...form.value,
        expected_version: existing.value?.version_no || 1,
        base_fee_fen:
          form.value.pricing_mode === "base_plus_unit"
            ? form.value.base_fee_fen
            : 0,
        unit_price_fen: ["fixed", "per_unit", "base_plus_unit"].includes(
          form.value.pricing_mode || "",
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
      },
    );
    await props.refresh();
    emit("update:open", false);
    ElMessage.success("正式版本已保存");
    for (const warning of saved.warnings || [])
      ElMessage.warning({ message: warning, duration: 8000 });
  } catch (failure) {
    const problem = failure as Error & { fields?: FieldErrors };
    errors.value = problem.fields || {};
    await focusError();
    ElMessage.error(problem.message);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <ElDialog
    append-to-body
    :model-value="open"
    :title="(existing ? '编辑' : '新增') + '参考价格规则'"
    width="800px"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="emit('update:open', $event)"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-model="tab"
        ><ElTabPane label="基本信息" name="basic" /><ElTabPane
          label="适用条件"
          name="conditions" /><ElTabPane label="计价方式" name="pricing"
      /></ElTabs>
      <div v-if="tab === 'basic'" class="panel">
        <div class="toolbar" style="flex-wrap: wrap">
          <span class="muted"
            >操作类型正式版本：{{
              form.adopt_latest_operation_version
                ? latestVersion
                : existing?.operation_version || latestVersion || "待选择"
            }}</span
          >
          <ElButton
            v-if="
              existing &&
              latestVersion &&
              existing.operation_id === form.operation_id &&
              latestVersion !== existing.operation_version &&
              !form.adopt_latest_operation_version
            "
            type="warning"
            plain
            @click="adoptLatest"
            >采用最新 V{{ latestVersion }} 作业标准</ElButton
          >
        </div>
        <p v-if="form.adopt_latest_operation_version" class="muted">
          将采用新的操作类型定义版本；请在“适用条件”中重新核对特征。
        </p>
      </div>
      <div class="form-grid">
        <ElFormItem
          v-for="field in fields"
          v-show="group(field) === tab && visible(field)"
          :key="field.key"
          :label="field.label"
          :prop="field.key"
          :error="String(errors[field.key] || '')"
          :rules="
            field.required && visible(field)
              ? [
                  {
                    required: true,
                    message: '请填写' + field.label,
                    trigger: 'blur',
                  },
                ]
              : []
          "
        >
          <FieldControl
            v-model="form[field.key]"
            :field="field"
            :selected-label="
              field.key === 'operation_id' &&
              existing &&
              !form.adopt_latest_operation_version &&
              form.operation_id === existing.operation_id
                ? existing.operation_id_label
                : undefined
            "
            @update:model-value="changed(field.key)"
          />
        </ElFormItem>
      </div>
      <PriceConditionsEditor v-if="tab === 'conditions'" :rule="form" />
      <PricingModelEditor v-if="tab === 'pricing'" :rule="form"
        :quantity-precision="pricingQuantityPrecision"
        @validity-change="pricingInputsInvalid = $event" />
      <ElAlert v-if="pricingPrecisionError" type="error" :closable="false"
        :title="'正式计量单位精度读取失败：' + pricingPrecisionError" />
      <div ref="checkPanel" class="panel" style="margin-top: 12px">
        <ElFormItem label="示例工作量（用于检查计算结果）"
          ><FieldControl v-model="sampleQuantity"
            :field="{ type: 'quantity', quantityPrecision: pricingQuantityPrecision }"
            @validity-change="sampleQuantityInvalid = $event"
        /></ElFormItem>
        <ElAlert
          v-if="checkError"
          type="error"
          :closable="false"
          :title="'规则检查未通过：' + checkError"
        />
        <template v-if="check">
          <ElAlert
            :type="check.overlaps.length ? 'warning' : 'success'"
            :closable="false"
            :title="
              check.overlaps.length
                ? '存在可能重叠的参考价格规则'
                : '规则完整性检查通过'
            "
          />
          <div
            v-if="check.overlaps.length"
            class="toolbar"
            style="margin-top: 8px; flex-wrap: wrap"
          >
            <ElTag
              v-for="item in check.overlaps"
              :key="item.id"
              type="warning"
              >{{ item.title }}</ElTag
            >
          </div>
          <p class="muted">
            所采用操作类型版本：V{{
              check.operation_version
            }}。检查不会写入数据；冲突规则须在正式报价时明确选择依据。
          </p>
          <p v-if="check.sample">
            <strong>试算金额：¥{{ money(check.sample.amount_fen) }}</strong
            ><span class="muted"
              >（工作量
              {{
                quantity(check.sample.quantity_scaled)
              }}，仅供核对计算模型）</span
            >
          </p>
          <p v-else-if="check.sample_error" class="muted">
            暂不能试算：{{
              check.sample_error
            }}。需先提供真实费用基数或选择有效的数量分档。
          </p>
        </template>
      </div>
    </ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="pricing.preview" :loading="checking" @click="preview">保存前检查</ElButton
      ><ElButton data-guide-action="pricing.save" type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
