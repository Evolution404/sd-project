<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage, type FormInstance } from "element-plus";
import type { PriceFactorRecord } from "../../../../server/shared/types/work-standards";
import type { FieldErrors } from "../../../../server/shared/types/contracts";
import { api } from "../../shared/api/client";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import FactorDefinitionEditor from "./FactorDefinitionEditor.vue";
const props = defineProps<{
  open: boolean;
  editing: PriceFactorRecord | null;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const form = ref({
    name: "",
    status: "active",
    fields_json: '{"kind":"enum","values":[]}',
  }),
  formRef = ref<FormInstance>(),
  saving = ref(false),
  errors = ref<FieldErrors>({});
const guard = useDialogDraftGuard(() => form.value);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    form.value = {
      name: props.editing?.name || "",
      status: props.editing?.status || "active",
      fields_json: props.editing?.fields_json || '{"kind":"enum","values":[]}',
    };
    errors.value = {};
    guard.capture();
  },
);
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
    if (!(await formRef.value?.validate().catch(() => false))) return;
    await api<unknown>(
      "/catalog/factors" + (props.editing ? "/" + props.editing.id : ""),
      "POST",
      { ...form.value, expected_version: props.editing?.version || 1 },
    );
    await props.refresh();
    emit("update:open", false);
    ElMessage.success("正式版本已保存");
  } catch (failure) {
    const problem = failure as Error & { fields?: FieldErrors };
    errors.value = problem.fields || {};
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
    :title="(editing ? '编辑' : '新增') + '价格特征'"
    width="800px"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="emit('update:open', $event)"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <div class="form-grid">
        <ElFormItem
          label="名称"
          prop="name"
          :error="String(errors.name || '')"
          :rules="[{ required: true, message: '请填写名称' }]"
          ><ElInput v-model="form.name"
        /></ElFormItem>
        <ElFormItem label="状态" required
          ><ElSelect v-model="form.status"
            ><ElOption label="启用" value="active" /><ElOption
              label="停用"
              value="inactive" /></ElSelect
        ></ElFormItem>
      </div>
      <FactorDefinitionEditor :factor="form" />
    </ElForm>
    <template #footer
      ><ElButton @click="close()">取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>
