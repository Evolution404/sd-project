<script setup lang="ts">
import { ref, watch } from "vue";
import type { OperationField } from "../../../../server/shared/types/work-standards";
import { newClientId } from "../../shared/utils/id";
const props = defineProps<{ operation: { fields_json?: unknown } }>(),
  fields = ref<
    Pick<OperationField, "key" | "label" | "type" | "required" | "options">[]
  >([]);
watch(
  () => props.operation,
  (operation) => {
    try {
      fields.value = JSON.parse(String(operation.fields_json || "[]"));
    } catch {
      fields.value = [];
    }
  },
  { immediate: true },
);
watch(
  fields,
  (value) => (props.operation.fields_json = JSON.stringify(value)),
  { deep: true },
);
function add() {
  fields.value.push({
    key: newClientId(),
    label: "",
    type: "text",
    required: false,
    options: [],
  });
}
</script>
<template>
  <section>
    <h3 class="subheading">补充现场字段</h3>
    <div v-for="(field, index) in fields" :key="field.key" class="panel">
      <div class="form-grid">
        <ElFormItem label="字段名称" required
          ><ElInput v-model="field.label" /></ElFormItem
        ><ElFormItem label="录入方式" required
          ><ElSelect v-model="field.type"
            ><ElOption label="文字" value="text" /><ElOption
              label="数值"
              value="number" /><ElOption label="日期" value="date" /><ElOption
              label="是 / 否"
              value="boolean" /><ElOption
              label="选择项"
              value="select" /></ElSelect></ElFormItem
        ><ElFormItem label="必须填写"
          ><ElSwitch v-model="field.required" /></ElFormItem
        ><ElFormItem v-if="field.type === 'select'" label="可选内容" required
          ><ElSelect
            v-model="field.options"
            multiple
            filterable
            allow-create
            default-first-option
            ><ElOption
              v-for="option in field.options"
              :key="option"
              :value="option"
              :label="option" /></ElSelect
        ></ElFormItem>
      </div>
      <ElButton type="danger" @click="fields.splice(index, 1)"
        >移除此字段</ElButton
      >
    </div>
    <ElButton @click="add">添加现场字段</ElButton>
  </section>
</template>
