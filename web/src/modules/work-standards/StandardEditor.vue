<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage, type FormInstance } from "element-plus";
import type {
  CatalogField,
  CatalogFormDefinition,
} from "../../../../server/shared/types/catalog";
import type {
  OperationRecord,
  WorkObjectRecord,
} from "../../../../server/shared/types/work-standards";
import type { FieldErrors } from "../../../../server/shared/types/contracts";
import { api } from "../../shared/api/client";
import { readAdoptedQuantityPrecision } from "../../shared/api/quantity-precision";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FieldControl from "../../shared/ui/FieldControl.vue";
import ExtraFieldsEditor from "./ExtraFieldsEditor.vue";
import OperationFeaturesEditor from "./OperationFeaturesEditor.vue";
const props = defineProps<{
  open: boolean;
  kind: "operations" | "objects";
  definition?: CatalogFormDefinition;
  editing: OperationRecord | WorkObjectRecord | null;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; saved: [] }>();
interface StandardDraft extends Record<string, unknown> {
  fields_json?: unknown;
  pricing_features_json?: unknown;
  price_features_load_error?: string;
}
const form = ref<StandardDraft>({}),
  formRef = ref<FormInstance>(),
  errors = ref<FieldErrors>({}),
  saving = ref(false),
  tab = ref("basic");
const fields = computed(() =>
  [
    ...(props.definition?.rootFields || []),
    ...(props.definition?.fields || []),
  ].filter((field) => !field.systemManaged),
);
const guard = useDialogDraftGuard(() => form.value);
const adoptedQuantityPrecision = ref<number | undefined>();
const adoptedPrecisionError = ref("");
const adoptedPrecisionLoading = ref(false);
const invalidDefaultQuantity = ref(false);
let precisionRequest = 0;
watch(() => [props.open, props.kind, form.value.default_unit_id,
  form.value.adopt_current_unit, props.editing] as const,
async ([open, kind, unitId, adoptCurrent, editing]) => {
  const seq = ++precisionRequest;
  adoptedQuantityPrecision.value = undefined;
  adoptedPrecisionError.value = "";
  adoptedPrecisionLoading.value = false;
  invalidDefaultQuantity.value = false;
  if (!open || kind !== "operations" || typeof unitId !== "string" || !unitId) return;
  adoptedPrecisionLoading.value = true;
  try {
    const frozenVersion = editing && "default_unit_id" in editing &&
      editing.default_unit_id === unitId && !adoptCurrent
      ? editing.default_unit_version : null;
    const version = frozenVersion || (await api<{ version: number }>(
      "/catalog/units/" + encodeURIComponent(unitId) + "?deleted=true")).version;
    const precision = await readAdoptedQuantityPrecision(unitId, version);
    if (seq === precisionRequest) adoptedQuantityPrecision.value = precision;
  } catch (failure) {
    if (seq === precisionRequest)
      adoptedPrecisionError.value = "正式计量单位精度读取失败：" + (failure as Error).message;
  } finally {
    if (seq === precisionRequest) adoptedPrecisionLoading.value = false;
  }
}, { immediate: true });
function fact(row: OperationRecord | WorkObjectRecord, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    errors.value = {};
    tab.value = "basic";
    form.value = {};
    for (const field of fields.value) {
      const value = props.editing ? fact(props.editing, field.key) : undefined;
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
    guard.capture();
  },
);
function close(done?: () => void) {
  void guard.confirmClose(() => {
    emit("update:open", false);
    done?.();
  });
}
function group(field: CatalogField) {
  if (props.kind === "objects") return "basic";
  if (field.key === "fields_json") return "extra";
  if (field.key === "pricing_features_json") return "pricingInfo";
  return [
    "completion_standard",
    "entry_hint",
    "default_target_object",
    "default_quantity_scaled",
  ].includes(field.key)
    ? "template"
    : "basic";
}
function visible(field: CatalogField) {
  return (
    props.kind === "objects" ||
    !["work_target_type", "fields_json", "pricing_features_json"].includes(
      field.key,
    )
  );
}
async function focusError() {
  const invalid = formRef.value?.fields.find(
    (field) => field.validateState === "error",
  );
  const field = fields.value.find(
    (field) => field.key === invalid?.prop || errors.value[field.key],
  );
  if (field) tab.value = group(field);
  else if (errors.value.fields_json) tab.value = "extra";
  else if (errors.value.pricing_features_json) tab.value = "pricingInfo";
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
    if (props.kind === "operations" &&
        (adoptedPrecisionLoading.value || adoptedQuantityPrecision.value === undefined ||
          invalidDefaultQuantity.value)) {
      tab.value = "template";
      throw new Error(adoptedPrecisionError.value ||
        "建议数量对应的正式计量单位精度尚未确认，请检查单位配置和数值");
    }
    if (form.value.price_features_load_error) {
      tab.value = "pricingInfo";
      throw new Error(form.value.price_features_load_error);
    }
    const version =
      props.editing &&
      ("version" in props.editing
        ? props.editing.version
        : props.editing.version_no);
    await api<unknown>(
      `/catalog/${props.kind}` + (props.editing ? "/" + props.editing.id : ""),
      "POST",
      { ...form.value, expected_version: version || 1 },
    );
    await props.refresh();
    emit("update:open", false);
    emit("saved");
    ElMessage.success("正式版本已保存");
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
    :title="(editing ? '编辑' : '新增') + (definition?.title || '')"
    width="800px"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="emit('update:open', $event)"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-if="kind === 'operations'" v-model="tab">
        <ElTabPane label="基本定义" name="basic" /><ElTabPane
          label="录入模板"
          name="template"
        />
        <ElTabPane label="附加字段" name="extra" /><ElTabPane
          label="计价所需信息"
          name="pricingInfo"
        />
      </ElTabs>
      <div class="form-grid">
        <ElFormItem
          v-for="field in fields"
          v-show="group(field) === tab && visible(field)"
          :key="field.key"
          :label="field.label"
          :prop="field.key"
          :error="String(errors[field.key] || '')"
          :rules="
            field.required
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
            :field="field.key === 'default_quantity_scaled'
              ? { ...field, quantityPrecision: adoptedQuantityPrecision } : field"
            @validity-change="field.key === 'default_quantity_scaled' &&
              (invalidDefaultQuantity = $event)"
            :selected-label="
              field.key === 'default_unit_id' &&
              editing &&
              'default_unit_id' in editing &&
              form.default_unit_id === editing.default_unit_id
                ? editing.default_unit_id_label
                : undefined
            "
          />
        </ElFormItem>
      </div>
      <ElAlert v-if="kind === 'operations' && tab === 'template' && adoptedPrecisionError"
        type="error" :closable="false" :title="adoptedPrecisionError" />
      <ElAlert v-if="kind === 'operations' && tab === 'template' && adoptedPrecisionLoading"
        type="info" :closable="false" title="正在读取正式计量单位精度" />
      <ExtraFieldsEditor
        v-if="kind === 'operations' && tab === 'extra'"
        :operation="form"
      />
      <OperationFeaturesEditor
        v-if="kind === 'operations' && tab === 'pricingInfo'"
        :operation="form"
      />
    </ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
