<script setup lang="ts">
import { computed } from "vue";
import { choiceLabels } from "../../../shared/utils/choice-labels";
import type { ProjectAgreementOption, ProjectManagementInput } from "../../../../../server/shared/types/projects";
import FieldControl from "../../../shared/ui/FieldControl.vue";

type ArchiveForm = ProjectManagementInput & {
  managing_unit_name?: string | null;
  managing_unit_version_id?: string | null;
};
const form = defineModel<ArchiveForm>({ required: true });
const props = defineProps<{
  editingStatus?: string;
  actors: ReadonlyArray<{ id: string; username: string }>;
  agreementChoices: ProjectAgreementOption[];
  agreementLoading: boolean;
  agreementError: string;
  projectAgreementInvalid: boolean;
}>();
const agreementLabels = computed(() => choiceLabels(props.agreementChoices, item => item.name,
  item => [item.counterparty_name, item.effective_from, item.effective_to, item.contract_number]));
const emit = defineEmits<{ framework: [id: string | null]; retry: [] }>();
</script>

<template>
  <ElFormItem
    label="项目名称"
    prop="name"
    :rules="[{ required: true, message: '请填写项目名称' }]"
    required
    ><ElInput v-model="form.name" /></ElFormItem>
  <ElFormItem
    data-guide-action="projects.funding" label="年度框架"
    prop="framework_id"
    :rules="[{ required: true, message: '请填写年度框架' }]"
    required
    ><FieldControl
      v-model="form.framework_id"
      :field="{ type: 'ref', reference: 'frameworks' }"
      :disabled="!!editingStatus && editingStatus !== 'reserve'"
      @update:model-value="value => emit('framework', value)" /></ElFormItem>
  <ElFormItem label="执行协议（选填）">
    <ElSelect v-model="form.agreement_id" clearable filterable
      placeholder="直接归属年度框架（无需执行协议）"
      :disabled="!form.framework_id || agreementLoading || editingStatus === 'closed'"
      :loading="agreementLoading">
      <template #label>{{ agreementLabels.get(String(form.agreement_id)) || "正在读取协议名称" }}</template>
      <ElOption v-for="item in agreementChoices" :key="item.id"
        :value="item.id" :label="agreementLabels.get(item.id)!"
        :disabled="!item.eligible" />
    </ElSelect>
    <p class="muted" style="font-size:12px;margin:6px 0 0">
      不选择执行协议，即直接归属所选年度框架；这是完整的项目归属方式，无需以后补选。
    </p>
  </ElFormItem>
  <ElAlert v-if="agreementError" class="full-width" type="error" :closable="false"
    :title="'执行协议读取失败：' + agreementError">
    <ElButton size="small" @click="emit('retry')">重试</ElButton>
  </ElAlert>
  <ElAlert v-else-if="form.framework_id && !agreementLoading && !agreementChoices.some((item) => item.eligible)"
    class="full-width" type="info" :closable="false"
    title="该框架下没有有效执行协议。子项目可以直接归属年度框架，无需创建或补选协议。" />
  <ElAlert v-else-if="projectAgreementInvalid" class="full-width" type="warning" :closable="false"
    title="所选执行协议已失效，请选择有效协议或清空关联。" />
  <ElFormItem label="项目类别"
    ><FieldControl
      v-model="form.category_id"
      :field="{ type: 'ref', reference: 'categories' }" /></ElFormItem>
  <ElFormItem label="归口单位"
    ><FieldControl
      v-model="form.managing_unit_id"
      :field="{
        type: 'ref',
        reference: 'organizations', adoptedLabel: form.managing_unit_name || undefined, adoptedVersionId: form.managing_unit_version_id || undefined,
      }" /></ElFormItem>
  <ElFormItem label="初步估算（元）"
    ><FieldControl
      v-model="form.preliminary_estimate_fen"
      :field="{ type: 'money' }" /></ElFormItem>
  <ElFormItem label="计划开始"
    ><ElDatePicker
      v-model="form.planned_start_on"
      value-format="YYYY-MM-DD" /></ElFormItem>
  <ElFormItem label="计划结束"
    ><ElDatePicker
      v-model="form.planned_end_on"
      value-format="YYYY-MM-DD" /></ElFormItem>
  <ElFormItem label="责任人"
    ><ElSelect
      v-model="form.owner_id"
      clearable
      filterable
      @clear="form.owner_id = null"
      ><ElOption
        v-for="actor in actors"
        :key="actor.id"
        :value="actor.id"
        :label="actor.username" /></ElSelect></ElFormItem>
  <ElFormItem label="管理人员"
    ><ElSelect
      v-model="form.manager_id"
      clearable
      filterable
      @clear="form.manager_id = null"
      ><ElOption
        v-for="actor in actors"
        :key="actor.id"
        :value="actor.id"
        :label="actor.username" /></ElSelect></ElFormItem>
</template>
