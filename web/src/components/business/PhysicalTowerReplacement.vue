<template>
  <el-dialog v-model="open" title="整基杆塔更换" width="min(95vw, 880px)" append-to-body
    :close-on-click-modal="false" :before-close="close">
    <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3">
      <el-button link type="primary" @click="load">重新核对回路</el-button>
    </el-alert>
    <el-skeleton v-if="loading" animated :rows="5" />
    <template v-else-if="preview">
      <el-alert type="info" :closable="false" class="mb-3" title="已冻结的需求和历史仍保留原设备。" />
      <el-descriptions border :column="3" class="mb-3">
        <el-descriptions-item label="物理杆塔编号">{{preview.physical.tower_code}}</el-descriptions-item>
        <el-descriptions-item label="现场铭牌">{{preview.physical.asset_no || "—"}}</el-descriptions-item>
        <el-descriptions-item label="正式版本">{{preview.physical.version}}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="preview.bindings" row-key="id" border max-height="220" empty-text="当前没有关联回路">
        <el-table-column prop="line_name" label="线路名称" min-width="180" />
        <el-table-column prop="voltage_level_name" label="电压等级" width="105" />
        <el-table-column prop="tower_no" label="杆塔号" width="105" />
        <el-table-column prop="logical_code" label="逻辑杆塔编号" min-width="145" />
        <el-table-column prop="version" label="当前版本" width="110" />
      </el-table>
      <el-form :model="form" label-position="top" novalidate :disabled="saving" class="mt-4">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="新杆塔现场铭牌">
              <el-input v-model="form.asset_no" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="新杆塔型号">
              <el-input v-model="form.model" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="新杆塔材质">
              <el-select v-model="form.tower_material" clearable filterable>
                <el-option v-for="item in materials" :key="item.value" :value="item.value" :label="item.label" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="新杆塔性质">
              <el-select v-model="form.tower_nature" clearable filterable>
                <el-option v-for="item in natures" :key="item.value" :value="item.value" :label="item.label" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="杆塔高度（米）">
              <el-input v-model="form.height_text" inputmode="decimal" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="投运日期">
              <el-date-picker v-model="form.commissioned_on" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经度">
              <el-input-number v-model="form.longitude" :min="-180" :max="180" :precision="6" controls-position="right" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="纬度">
              <el-input-number v-model="form.latitude" :min="-90" :max="90" :precision="6" controls-position="right" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="用途"><el-input v-model="form.purpose" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </template>
    <template #footer>
      <el-button :disabled="saving" @click="close()">取消</el-button>
      <el-button type="primary" :disabled="loading || !preview" :loading="saving" data-guide-action="ledger.replace-submit" @click="save">
        确认整基更换
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { onBeforeRouteLeave } from "vue-router";
import type { OptionItem } from "@/api/common";
import { physicalReplacementPreview, replacePhysicalTower,
  type EquipmentForm, type EquipmentRow, type PhysicalReplacementPreview } from "@/api/business/equipment";

const props = defineProps<{ physicalId: string; materials: OptionItem[]; natures: OptionItem[] }>();
const emit = defineEmits<{ replaced: [tower: EquipmentRow] }>();
const open = defineModel<boolean>({ required: true });
const preview = ref<PhysicalReplacementPreview>();
const form = ref<EquipmentForm>({});
const loading = ref(false);
const saving = ref(false);
const error = ref("");
let sequence = 0;

async function load() {
  const request = ++sequence;
  loading.value = true;
  error.value = "";
  preview.value = undefined;
  try {
    const facts = await physicalReplacementPreview(props.physicalId);
    if (request === sequence) preview.value = facts;
  } catch (cause) {
    if (request === sequence) error.value = (cause as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}

async function allowClose() {
  if (saving.value) return false;
  if (open.value && Object.values(form.value).some(value => value !== "" && value != null)) {
    try {
      await ElMessageBox.confirm("当前更换资料尚未保存，确定放弃？", "放弃整基更换", {
        type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续填写",
      });
    } catch {
      return false;
    }
  }
  return true;
}

async function close(done?: () => void) {
  if (!(await allowClose())) return;
  if (done) done();
  else open.value = false;
}

async function save() {
  if (!preview.value || saving.value) return;
  saving.value = true;
  try {
    const result = await replacePhysicalTower(preview.value, form.value);
    open.value = false;
    emit("replaced", result);
    ElMessage.success("整基更换已登记");
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}

watch(open, active => {
  if (active) {
    form.value = {};
    void load();
  } else sequence++;
});
onBeforeRouteLeave(allowClose);
</script>
