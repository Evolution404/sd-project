<script setup lang="ts">
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import VersionConflictNotice from "../../shared/ui/VersionConflictNotice.vue";
import BusinessEditorSurface from "../../shared/ui/BusinessEditorSurface.vue";
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
import { ApiError, api } from "../../shared/api/client";
import { readAdoptedQuantityPrecision } from "../../shared/api/quantity-precision";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FieldControl from "../../shared/ui/FieldControl.vue";
import AttributesEditor from "./AttributesEditor.vue";
import OperationVersionHistory from "./OperationVersionHistory.vue";
const props = defineProps<{
  open: boolean;
  kind: "operations" | "objects";
  definition?: CatalogFormDefinition;
  editing: OperationRecord | WorkObjectRecord | null;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; saved: [] }>();
interface StandardDraft extends Record<string, unknown> {
  attributes_schema_json?: string;
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
    if (props.kind === "operations" && props.editing)
      form.value.adopt_current_object = false;
    guard.capture();
  },
);
onBeforeRouteLeave(() => !props.open || guard.canClose());
onBeforeRouteUpdate((to, from) => !props.open || to.path === from.path || guard.canClose());
function close(done?: () => void) {
  void guard.confirmClose(() => {
    guard.capture();
    emit("update:open", false);
    done?.();
  });
}
function group(field: CatalogField) {
  if (props.kind === "objects") return "basic";
  if (field.key === "attributes_schema_json") return "extra";
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
    field.key !== "attributes_schema_json"
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
  else if (errors.value.attributes_schema_json) tab.value = "extra";
  await nextTick();
  (formRef.value?.$el as HTMLElement | undefined)
    ?.querySelector<HTMLElement>(".el-form-item.is-error input")
    ?.focus();
}
const definitionConflict = ref("");
watch(() => props.open, () => { definitionConflict.value = ""; });
async function compareDefinition() {
  if (!props.editing) return [];
  const current = await api<OperationRecord | WorkObjectRecord>(`/catalog/${props.kind}/${props.editing.id}`);
  const revision = (record: OperationRecord | WorkObjectRecord) => "version" in record ? record.version : record.version_no;
  return [
    { label: "正式版本", draft: String(revision(props.editing)), current: String(revision(current)) },
    { label: "业务名称", draft: String(form.value.name || "—"), current: current.name },
  ];
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
    guard.capture();
    emit("saved");
    ElMessage.success("正式版本已保存");
  } catch (failure) {
    const problem = failure as Error & { fields?: FieldErrors };
    errors.value = problem.fields || {};
    await focusError();
    if (props.editing && failure instanceof ApiError && failure.status === 409) definitionConflict.value = failure.message;
    else ElMessage.error(problem.message);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <BusinessEditorSurface page
    :open="open"
    :title="(editing ? '编辑' : '新增') + (definition?.title || '')"
    width="min(980px, 96vw)"
    :busy="saving"
    @close="close()"
  >
    <VersionConflictNotice :message="definitionConflict" :read-current="compareDefinition" />
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-if="kind === 'operations'" v-model="tab">
        <ElTabPane label="基本定义" name="basic" />
        <ElTabPane label="录入模板" name="template" />
        <ElTabPane label="附加属性" name="extra" />
        <ElTabPane label="正式版本与引用" name="versions" />
      </ElTabs>
      <p v-if="tab === 'basic' && editing" class="muted">系统稳定编码 {{editing.code}}</p>
      <p v-if="kind === 'operations' && tab === 'basic'" class="muted">
        对象位置与归属单元统一在作业对象中配置，操作类型继承所采用的作业对象正式版本，不重复设置。
      </p>
      <ElCheckbox v-if="kind === 'operations' && editing && tab === 'basic'"
        :model-value="Boolean(form.adopt_current_object)"
        @update:model-value="form.adopt_current_object = Boolean($event)">采用作业对象当前正式版本（更新归属单元和对象位置）</ElCheckbox>
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
      <AttributesEditor v-if="kind === 'operations' && tab === 'extra'" :model-value="form.attributes_schema_json || '[]'"
        @update:model-value="form.attributes_schema_json=$event" />
      <section v-if="kind === 'operations' && tab === 'versions'">
        <p v-if="!editing" class="muted">首次保存后建立正式版本。</p>
        <OperationVersionHistory v-else :id="editing.id" />
      </section>
    </ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="standards.save" type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    >
  </BusinessEditorSurface>
</template>
