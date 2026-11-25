<template>
  <section v-if="open" :aria-label="title" data-guide-workspace class="page-container">
    <el-card class="page-content" shadow="never">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <div class="page-heading-actions">
            <el-button :disabled="saving" @click="close()">{{ readonly ? "关闭" : "取消" }}</el-button>
            <el-button v-if="!readonly" type="primary" :disabled="loading || Boolean(loadError)" :loading="saving"
              data-guide-action="standards.save" @click="save">保存正式版本</el-button>
          </div>
        </div>
      </template>
    <el-skeleton v-if="loading" :rows="7" animated />
    <el-alert v-else-if="loadError" type="error" :title="loadError" :closable="false">
      <el-button type="primary" link @click="load">重新读取</el-button>
    </el-alert>
    <template v-else>
      <el-tabs v-model="tab">
        <el-tab-pane label="基本定义" name="basic" />
        <el-tab-pane label="录入模板" name="template" />
        <el-tab-pane label="附加属性" name="attributes" />
        <el-tab-pane label="正式版本与引用" name="versions" />
      </el-tabs>
      <el-alert v-if="saveError" type="error" :title="saveError" :closable="false" class="mb-3" />
      <el-form :model="form" label-position="top" novalidate :disabled="readonly || saving">
        <el-row v-if="tab === 'basic'" :gutter="16">
          <el-col :span="12">
            <el-form-item label="名称" required><el-input v-model="form.name" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio value="active">启用</el-radio><el-radio value="inactive">停用</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="作业对象" required>
              <el-select v-model="form.work_object_id" filterable>
                <el-option v-for="object in objectOptions" :key="object.id" :value="object.id" :label="object.name"
                  :disabled="object.status !== 'active'" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="adoptedObject" :label="'已采用对象版本 V' + record?.work_object_version_no">
              <el-space wrap><span>对象位置：{{ record?.object_position === "body" ? "本体" : "通道" }}</span><span>归属单元：{{ record?.attribution_unit === "physical_tower" ? "物理杆塔" : "逻辑杆塔" }}</span></el-space>
              <el-checkbox v-if="!readonly" v-model="form.adopt_current_object">采用对象当前正式版本</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="固定计量单位" required>
              <el-select v-model="form.default_unit_id" filterable>
                <el-option v-for="unit in unitOptions" :key="unit.id" :value="unit.id" :label="unit.name"
                  :disabled="unit.status !== 'active'" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="adoptedUnit" :label="'已采用单位版本 V' + record?.default_unit_version">
              <el-checkbox v-if="!readonly" v-model="form.adopt_current_unit">采用单位当前正式版本</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="1" :precision="0" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="修订说明"><el-input v-model="form.reason" /></el-form-item>
          </el-col>
        </el-row>
        <el-row v-if="tab === 'template'" :gutter="16">
          <el-col :span="12">
            <el-form-item label="默认部位"><el-input v-model="form.default_target_object" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="建议数量">
              <el-input v-model="form.default_quantity_text" inputmode="decimal" placeholder="空白表示没有建议数量" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="验收标准"><el-input v-model="form.completion_standard" type="textarea" :rows="2" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="录入提示"><el-input v-model="form.entry_hint" type="textarea" :rows="2" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <OperationAttributesEditor v-if="attributesOpened" v-show="tab === 'attributes'" ref="attributesEditor" v-model="form.attributes"
        :units="units" :readonly="readonly" :disabled="saving" />
      <section v-if="tab === 'versions'" aria-label="正式版本与引用">
        <el-empty v-if="!details" description="首次保存后建立正式版本" />
        <template v-else>
          <el-table :data="details.versions" row-key="id" border max-height="285">
            <el-table-column label="正式版本" width="100">
              <template #default="{ row }">V{{ row.version }}</template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="140" />
            <el-table-column label="冻结对象版本" width="130">
              <template #default="{ row }">V{{ row.work_object_version_no }}</template>
            </el-table-column>
            <el-table-column label="冻结单位版本" width="130">
              <template #default="{ row }">V{{ row.default_unit_version }}</template>
            </el-table-column>
            <el-table-column label="变更时间" min-width="160">
              <template #default="{ row }">{{ formatBeijingDateTime(row.changed_at) }}</template>
            </el-table-column>
            <el-table-column prop="reason" label="修订说明" min-width="130" />
            <el-table-column label="详情" width="95">
              <template #default="{ row }">
                <el-button link type="primary" :aria-label="'查看第' + row.version + '版定义'"
                  @click="historicalVersion = row.version">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <template v-if="historical">
            <el-descriptions :title="'V' + historical.version + ' 录入模板'" border :column="2" class="mt-4">
              <el-descriptions-item label="默认部位">{{ historical.default_target_object || "—" }}</el-descriptions-item>
              <el-descriptions-item label="建议数量">{{ historical.default_quantity_scaled == null ? "—" : formatScaledDecimal(historical.default_quantity_scaled, 4) }}</el-descriptions-item>
              <el-descriptions-item label="验收标准">{{ historical.completion_standard || "—" }}</el-descriptions-item>
              <el-descriptions-item label="录入提示">{{ historical.entry_hint || "—" }}</el-descriptions-item>
            </el-descriptions>
            <OperationAttributesEditor :model-value="historicalAttributes" :units="units" readonly />
          </template>
          <el-divider>需求采用记录</el-divider>
          <el-table :data="details.adoptions.demands" border max-height="245">
            <el-table-column prop="demand_no" label="需求编号" min-width="145" />
            <el-table-column prop="demand_version" label="需求版本" width="115" />
            <el-table-column prop="operation_version" label="采用操作版本" width="140" />
          </el-table>
          <el-divider>参考价格采用记录</el-divider>
          <el-table :data="details.adoptions.prices" border max-height="245">
            <el-table-column prop="title" label="价格规则" min-width="160" />
            <el-table-column prop="version_no" label="规则版本" width="115" />
            <el-table-column prop="operation_version" label="采用操作版本" width="140" />
          </el-table>
        </template>
      </section>
    </template>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { OperationDetail } from "../../../../server/shared/types/work-standards";
import type { DictionaryRow } from "@/api/business/dictionaries";
import { operationDetail, saveStandard, type WorkForm, type WorkStandardRow } from "@/api/business/standards";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import OperationAttributesEditor from "./OperationAttributesEditor.vue";

const props = defineProps<{ operationId?: string; objects: WorkStandardRow[]; units: DictionaryRow[]; readonly: boolean }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();
const title = computed(() => props.readonly ? "查看操作类型" : props.operationId ? "修订操作类型" : "新增操作类型");
const details = ref<OperationDetail>();
const record = computed(() => details.value?.item);
const form = ref<WorkForm & { attributes: OperationAttribute[] }>(emptyForm());
const tab = ref("basic");
const loading = ref(false), saving = ref(false);
const loadError = ref(""), saveError = ref("");
const historicalVersion = ref<number>();
const historical = computed(() => details.value?.versions.find(version => version.version === historicalVersion.value));
const historicalAttributes = computed<OperationAttribute[]>(() => JSON.parse(historical.value?.attributes_schema_json || "[]"));
const attributesEditor = ref<InstanceType<typeof OperationAttributesEditor>>();
const attributesOpened = ref(false);
watch(tab, value => { if (value === "attributes") attributesOpened.value = true; });
let sequence = 0;
let baseline = "";

const adoptedObject = computed(() => Boolean(record.value && record.value.work_object_id === form.value.work_object_id));
const adoptedUnit = computed(() => Boolean(record.value && record.value.default_unit_id === form.value.default_unit_id));
const objectOptions = computed(() => {
  const options = props.objects;
  const original = record.value;
  if (!original || options.some(option => option.id === original.work_object_id)) return options;
  return [...options, { id: original.work_object_id, name: original.work_object_id_label, status: "inactive" }];
});
const unitOptions = computed(() => {
  const options = props.units;
  const original = record.value;
  if (!original || options.some(option => option.id === original.default_unit_id)) return options;
  return [...options, { id: original.default_unit_id, name: original.default_unit_id_label, status: "inactive" }];
});

function emptyForm() {
  return { name: "", status: "active" as const, sort_order: 100, attributes: [] };
}
async function load() {
  const request = ++sequence;
  details.value = undefined;
  form.value = emptyForm();
  baseline = "";
  loadError.value = "";
  saveError.value = "";
  tab.value = "basic";
  attributesOpened.value = false;
  historicalVersion.value = undefined;
  loading.value = Boolean(props.operationId);
  try {
    if (props.operationId) {
      const response = await operationDetail(props.operationId);
      if (request !== sequence) return;
      details.value = response;
      const row = response.item;
      form.value = {
        version: row.version, name: row.name, work_object_id: row.work_object_id,
        default_unit_id: row.default_unit_id, status: row.status, sort_order: row.sort_order,
        default_target_object: row.default_target_object, completion_standard: row.completion_standard ?? "",
        entry_hint: row.entry_hint, attributes: JSON.parse(row.attributes_schema_json),
        default_quantity_text: row.default_quantity_scaled == null ? "" : formatScaledDecimal(row.default_quantity_scaled, 4),
      };
    }
    baseline = JSON.stringify(form.value);
  } catch (cause) {
    if (request === sequence) loadError.value = (cause as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}

function dirty() {
  return open.value && !props.readonly && Boolean(baseline) && (baseline !== JSON.stringify(form.value) || attributesEditor.value?.changed());
}
async function allowClose() {
  if (saving.value) return false;
  await attributesEditor.value?.finishEditing();
  if (!dirty()) return true;
  try {
    await ElMessageBox.confirm("操作定义尚未保存，确定放弃？", "离开操作定义编制", {
      type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续编制",
    });
    return true;
  } catch {
    return false;
  }
}
async function close() {
  if (await allowClose()) open.value = false;
}
async function save() {
  if (loading.value || saving.value || props.readonly) return;
  if (!form.value.name.trim() || !form.value.work_object_id || !form.value.default_unit_id) {
    tab.value = "basic";
    saveError.value = "请填写名称、作业对象及固定计量单位";
    return;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const attributes = attributesEditor.value ? await attributesEditor.value.prepare() : form.value.attributes;
    if (!attributes) { tab.value = "attributes"; return; }
    await saveStandard("operations", { ...form.value, attributes }, props.operationId);
    open.value = false;
    emit("saved");
    ElMessage.success("操作正式版本已保存");
  } catch (cause) {
    const failure = cause as Error & { fields?: Record<string, unknown> };
    if (failure.fields?.attributes_schema_json) tab.value = "attributes";
    else if (failure.fields?.default_quantity_scaled || failure.message.includes("建议数量")) tab.value = "template";
    saveError.value = failure.message;
  } finally {
    saving.value = false;
  }
}

watch(open, active => {
  if (active) void load();
  else sequence++;
});
onBeforeRouteLeave(allowClose);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty() || saving.value) event.preventDefault();
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
