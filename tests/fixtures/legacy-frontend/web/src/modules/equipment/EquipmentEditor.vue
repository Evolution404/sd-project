<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { ElMessage, type FormInstance } from "element-plus";
import type {
  EquipmentCatalogKind,
  EquipmentRecord,
  EquipmentFields,
} from "../../../../server/shared/types/equipment";
import type {
  CatalogFormDefinition,
  CatalogField,
} from "../../../../server/shared/types/catalog";
import type { FieldErrors } from "../../../../server/shared/types/contracts";
import { api } from "../../shared/api/client";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FieldControl from "../../shared/ui/FieldControl.vue";
interface EquipmentField extends CatalogField {
  key: keyof EquipmentRecord;
}
const props = defineProps<{
  open: boolean;
  kind: EquipmentCatalogKind;
  definition?: CatalogFormDefinition;
  physicalDefinition?: CatalogFormDefinition;
  editing: EquipmentRecord | null;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const fields = computed(
  () =>
    [
      ...(props.definition?.rootFields || []),
      ...(props.definition?.fields || []),
    ].filter(
      (field) =>
        !field.systemManaged &&
        !(props.kind === "towers" && field.key === "sort_rank"),
    ) as EquipmentField[],
);
const physicalFields = computed(
  () =>
    (props.physicalDefinition?.fields || []).filter(
      (field) => !["status", "asset_no"].includes(field.key),
    ) as EquipmentField[],
);
const natureField = computed(() =>
  physicalFields.value.find((field) => field.key === "tower_nature"),
);
const optionalPhysical = computed(() =>
  physicalFields.value.filter((field) => field.key !== "tower_nature"),
);
const form = ref<
  EquipmentFields & {
    physical_mode: "new" | "shared";
    physical_properties: EquipmentFields;
  }
>({ physical_mode: "new", physical_properties: {} });
const formRef = ref<FormInstance>(),
  saving = ref(false),
  errors = ref<FieldErrors>({});
const guard = useDialogDraftGuard(() => form.value);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    errors.value = {};
    form.value = {
      physical_mode: props.editing?.physical_tower_id ? "shared" : "new",
      physical_properties: {},
    };
    for (const field of fields.value) {
      const value =
        props.editing?.[field.key] ??
        field.default ??
        (field.type === "text" && !field.nullable ? "" : null);
      form.value[field.key] =
        typeof value === "string" || typeof value === "number" ? value : null;
    }
    guard.capture();
  },
);
function visible(field: EquipmentField) {
  if (props.kind === "physical" && field.key === "asset_no" && !props.editing)
    return false;
  if (props.kind === "lines") {
    if (field.key === "parent_line_id")
      return form.value.line_kind === "branch";
    if (field.key === "junction_tower_id")
      return form.value.line_kind === "branch" && !!form.value.parent_line_id;
  }
  return !(
    props.kind === "towers" &&
    !props.editing &&
    field.key === "physical_tower_id" &&
    form.value.physical_mode !== "shared"
  );
}
function filters(field: EquipmentField): Record<string, string> {
  if (props.kind === "lines" && field.key === "parent_line_id")
    return { line_kind: "main" };
  if (props.kind === "lines" && field.key === "junction_tower_id")
    return { line_id: String(form.value.parent_line_id || "") };
  if (
    props.kind === "spans" &&
    ["start_tower_id", "end_tower_id"].includes(field.key)
  )
    return {
      line_id: String(form.value.line_id || ""),
      exclude_id: String(
        form.value[
          field.key === "start_tower_id" ? "end_tower_id" : "start_tower_id"
        ] || "",
      ),
    };
  return {};
}
function disabled(field: EquipmentField) {
  return (
    (!!props.editing && !!field.immutable) ||
    (props.kind === "lines" &&
      field.key === "junction_tower_id" &&
      !form.value.parent_line_id) ||
    (props.kind === "spans" &&
      ["start_tower_id", "end_tower_id"].includes(field.key) &&
      !form.value.line_id)
  );
}
function changed(key: keyof EquipmentRecord) {
  if (props.kind === "lines") {
    if (key === "line_kind" && form.value.line_kind !== "branch") {
      form.value.parent_line_id = null;
      form.value.junction_tower_id = null;
    }
    if (key === "parent_line_id") form.value.junction_tower_id = null;
  }
  if (props.kind === "spans") {
    if (key === "line_id") {
      form.value.start_tower_id = null;
      form.value.end_tower_id = null;
    }
    if (
      key === "start_tower_id" &&
      form.value.start_tower_id === form.value.end_tower_id
    )
      form.value.end_tower_id = null;
    if (
      key === "end_tower_id" &&
      form.value.start_tower_id === form.value.end_tower_id
    )
      form.value.start_tower_id = null;
  }
}
function close(done?: () => void) {
  void guard.confirmClose(() => {
    emit("update:open", false);
    done?.();
  });
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      await nextTick();
      (formRef.value?.$el as HTMLElement | undefined)
        ?.querySelector<HTMLElement>(".el-form-item.is-error input")
        ?.focus();
      ElMessage.warning("请完善标红的必填信息后保存");
      return;
    }
    const body = {
      ...form.value,
      expected_version: props.editing?.version || 1,
      historical_update: !!props.editing?.deleted,
    };
    if (
      props.kind === "towers" &&
      !props.editing &&
      form.value.physical_mode === "new"
    )
      delete body.physical_tower_id;
    if (form.value.physical_mode === "shared") body.physical_properties = {};
    await api<EquipmentRecord>(
      "/catalog/" + props.kind + (props.editing ? "/" + props.editing.id : ""),
      "POST",
      body,
    );
    ElMessage.success("正式版本已保存，正在刷新列表");
    await props.refresh();
    emit("update:open", false);
  } catch (failure) {
    const error = failure as Error & { fields?: FieldErrors };
    errors.value = error.fields || {};
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}
function fieldError(key: string): string {
  const value = errors.value[key];
  return Array.isArray(value) ? value.join("、") : value || "";
}
</script>
<template>
  <ElDialog
    :model-value="open"
    append-to-body
    :title="(editing ? '编辑' : '新增') + (definition?.title || '')"
    width="800px"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="(value: boolean) => emit('update:open', value)"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <template v-if="kind === 'towers' && !editing">
        <ElFormItem label="实际杆塔关系"
          ><ElRadioGroup v-model="form.physical_mode"
            ><ElRadioButton value="new">新建独立杆塔</ElRadioButton
            ><ElRadioButton value="shared"
              >与已有杆塔共用实体</ElRadioButton
            ></ElRadioGroup
          ></ElFormItem
        >
        <ElFormItem
          v-if="form.physical_mode === 'new' && natureField"
          label="杆塔性质"
          ><FieldControl
            v-model="form.physical_properties.tower_nature"
            :field="natureField"
        /></ElFormItem>
        <ElCollapse v-if="form.physical_mode === 'new'"
          ><ElCollapseItem title="实物属性（按需填写）" name="physical"
            ><div class="form-grid">
              <ElFormItem
                v-for="field in optionalPhysical"
                :key="field.key"
                :label="field.label"
                ><FieldControl
                  v-model="form.physical_properties[field.key]"
                  :field="field"
              /></ElFormItem></div></ElCollapseItem
        ></ElCollapse>
      </template>
      <div class="form-grid">
        <ElFormItem
          v-for="field in fields"
          v-show="visible(field)"
          :key="field.key"
          :label="field.label"
          :prop="field.key"
          :error="fieldError(field.key)"
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
          ><FieldControl
            v-model="form[field.key]"
            :field="field"
            :filters="filters(field)"
            :disabled="disabled(field)"
            @update:model-value="changed(field.key)"
        /></ElFormItem>
      </div>
    </ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="ledger.save" type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
