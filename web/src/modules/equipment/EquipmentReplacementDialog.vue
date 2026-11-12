<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import type { CatalogFormDefinition } from "../../../../server/shared/types/catalog";
import type {
  EquipmentFields,
  EquipmentRecord,
  ReplacementPreview,
} from "../../../../server/shared/types/equipment";
import { api } from "../../shared/api/client";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable from "../../shared/ui/BusinessTable.vue";
const props = defineProps<{
  open: boolean;
  physical: EquipmentRecord | null;
  definition?: CatalogFormDefinition;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const preview = ref<ReplacementPreview | null>(null),
  form = ref<EquipmentFields>({}),
  loading = ref(false),
  saving = ref(false),
  error = ref("");
const invalidNumericFields = ref<Record<string, boolean>>({});
const fields = computed(() =>
  (props.definition?.fields || []).filter(
    (field) => !["status", "asset_no"].includes(field.key),
  ),
);
const guard = useDialogDraftGuard(() => form.value);
let sequence = 0;
async function load() {
  const current = ++sequence;
  preview.value = null;
  error.value = "";
  loading.value = true;
  try {
    const value = await api<ReplacementPreview>(
      `/catalog/physical/${props.physical!.id}/replacement`,
    );
    if (current === sequence) preview.value = value;
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      form.value = {};
      invalidNumericFields.value = {};
      guard.capture();
      void load();
    } else sequence++;
  },
);
function close(done?: () => void) {
  void guard.confirmClose(() => {
    emit("update:open", false);
    done?.();
  });
}
async function save() {
  if (!preview.value || saving.value) return;
  if (Object.values(invalidNumericFields.value).some(Boolean)) {
    ElMessage.error("新杆塔存在无效数值，请修正输入后再确认更换");
    return;
  }
  saving.value = true;
  try {
    await api(
      `/catalog/physical/${preview.value.physical.id}/replacement`,
      "POST",
      {
        expected_version: preview.value.physical.version,
        bindings: preview.value.bindings.map((row) => ({
          id: row.id,
          version: row.version,
        })),
        properties: form.value,
      },
    );
    await props.refresh();
    emit("update:open", false);
    ElMessage.success("整基更换已记录，原实体及关联历史已归档");
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <ElDialog
    :model-value="open"
    append-to-body
    title="整基杆塔更换"
    width="850px"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="(value) => emit('update:open', value)"
  >
    <ElAlert
      title="核对全部关联回路后建立新实物。历史需求继续采用原正式位置。"
      type="info"
      :closable="false"
    />
    <ElAlert v-if="error" :title="error" type="error" :closable="false"
      ><ElButton @click="load">重试</ElButton></ElAlert
    >
    <BusinessTable
      client-side
      table-key="physical:replacement-bindings"
      :loading="loading"
      :rows="preview?.bindings || []"
      :columns="[{ key: 'label', label: '本次全部关联回路', minWidth: 250 }]"
    />
    <ElForm :model="form" label-position="top" novalidate
      ><div class="form-grid">
        <ElFormItem
          v-for="field in fields"
          :key="field.key"
          :label="'新杆塔' + field.label"
          ><FieldControl
            v-model="form[field.key as keyof EquipmentRecord]"
            :field="field"
            @validity-change="invalidNumericFields[field.key] = $event"
        /></ElFormItem></div
    ></ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton data-guide-action="ledger.replace-submit"
        type="primary"
        :loading="saving"
        :disabled="loading || !preview"
        @click="save"
        >确认整基更换</ElButton
      ></template
    >
  </ElDialog>
</template>
