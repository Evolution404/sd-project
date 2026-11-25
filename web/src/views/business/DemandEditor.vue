<template>
  <div data-guide-workspace class="page-container" v-loading="loading">
    <el-card class="page-content demand-editor-card" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">
            {{ record ? "修订专业需求" : "新增专业需求" }}
          </h2>
          <div class="page-heading-actions flex flex-wrap gap-2">
            <el-button @click="returnToList()">返回专业需求</el-button>
            <el-button data-guide-action="demands.save"
              type="primary"
              :loading="saving"
              :disabled="loading || loadFailed || !operation || !positions.length"
              @click="persist()"
            >
              保存专业需求
            </el-button>
          </div>
        </div>
      </template>
      <el-alert v-if="error" class="mb-3" type="error" :title="error" :closable="false" show-icon>
        <el-button v-if="loadFailed" link type="primary" @click="load">重新读取专业需求</el-button>
      </el-alert>
      <el-alert
        v-if="setupMissing"
        class="mb-3"
        type="info"
        title="先配置计量单位、作业对象和操作类型。"
        :closable="false"
      >
        <el-button v-if="canConfigure" link type="primary" @click="openSetup">
          保留草稿并配置作业标准
        </el-button>
        <span v-else>请联系管理员配置后继续录入。</span>
      </el-alert>

      <div ref="demandScroll" class="demand-scroll" @scroll.passive="syncSection">
        <el-tabs :model-value="section" class="demand-section-nav" @tab-change="navigateSection">
          <el-tab-pane label="基本信息" name="basic" />
          <el-tab-pane :label="`作业位置（${positions.length}）`" name="positions" />
          <el-tab-pane :label="`预计物资（${materials.length}）`" name="materials" />
          <el-tab-pane label="需求来源" name="sources" />
        </el-tabs>
        <el-form label-position="top" novalidate :disabled="saving || loading || loadFailed">
          <section data-demand-section="basic" class="demand-form-section"><h3>基本信息</h3>
            <el-form-item label="操作类型" required>
              <el-select
                :model-value="operation?.id"
                filterable
                remote
                :remote-method="searchOperations"
                :disabled="Boolean(record) || loading || loadFailed"
                :loading="loadingOperations"
                placeholder="搜索操作名称"
                @update:model-value="chooseOperation"
              >
                <el-option
                  v-for="item in operations"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-descriptions v-if="operation" :column="2" border class="mb-4">
              <el-descriptions-item label="作业对象">
                {{ operation.work_object_id_label }}
              </el-descriptions-item>
              <el-descriptions-item label="操作定义版本">
                第 {{ operation.version }} 版
              </el-descriptions-item>
              <el-descriptions-item label="需求数量">
                {{ formatScaledDecimal(total, 4) }} {{ operation.default_unit_id_label }}
              </el-descriptions-item>
              <el-descriptions-item label="数量精度">{{ precision }} 位小数</el-descriptions-item>
              <el-descriptions-item v-if="operation.entry_hint" label="录入提示" :span="2">
                {{ operation.entry_hint }}
              </el-descriptions-item>
            </el-descriptions>
            <el-form-item label="问题描述" required>
              <el-input v-model="form.problem" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="处理部位"><el-input v-model="form.target" /></el-form-item>
            <el-form-item label="验收标准" required>
              <el-input v-model="form.completion" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item label="预计解决时间">
              <el-date-picker v-model="form.expectedOn" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="需求优先级">
              <el-select v-model="form.priority" clearable filterable placeholder="可选">
                <el-option
                  v-for="row in priorities"
                  :key="row.id"
                  :label="row.name"
                  :value="row.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-if="record" label="修订说明">
              <el-input v-model="form.reason" type="textarea" />
            </el-form-item>
            <DemandAttributeFields v-model="form.attributes" :fields="demandFields" />
          </section>

          <section data-demand-section="positions" class="demand-form-section"><h3>作业位置</h3>
            <el-empty v-if="!operation" description="请选择操作类型" />
            <template v-else>
              <div class="business-control-row mb-3">
                <el-form-item label="位置类型" label-position="left" class="mb-0">
                  <el-select v-model="kind" style="width: 150px" @change="resetPositionSearch">
                    <el-option
                      v-for="option in positionKinds"
                      :key="option"
                      :label="kindLabel[option]"
                      :value="option"
                    />
                  </el-select>
                </el-form-item>
                <el-button data-guide-action="demands.location-add" type="primary" @click="positionPickerOpen=true">选择作业设备</el-button>
                <el-button data-guide-action="demands.location-quick" @click="quickPickerOpen=true">按杆号快速选择</el-button>
                <DemandTowerQuickPicker v-if="quickPickerOpen" :kind="kind" :existing-count="positions.length"
                  :selectable="canSelectPosition" @close="quickPickerOpen=false" @confirm="addQuickPositions"/>
                <NativeRecordPicker v-if="positionPickerOpen" title="选择作业设备" placeholder="搜索杆塔、线路或档距"
                  confirm-label="添加所选位置" confirm-guide="demands.location-select-confirm"
                  :columns="positionPickerColumns" :loader="loadPositionPage" :selectable="canSelectPosition"
                  @close="positionPickerOpen=false" @confirm="addPositions"/>
              </div>
              <div v-if="positions.length" aria-label="作业位置数量工作表">
                <BusinessWorksheet ref="positionSheet" data-grid-key="demands:positions"
                  name="作业位置数量" :session-key="positionSession"
                  :rows="positionRows" :columns="positionColumns" :validate="validatePositions"
                  :disabled="saving" @change="updatePosition" />
              </div>
              <el-collapse v-if="positions.length" v-model="expandedPositions" class="mt-3" aria-label="作业方式及位置属性">
                <el-collapse-item
                  v-for="position in visiblePositionDetails"
                  :key="position.id"
                  :name="position.id"
                  :title="position.label"
                >
                  <template v-if="expandedPositions.includes(position.id)">
                    <el-form-item label="作业方式">
                      <el-select v-model="position.workMode" style="width: 180px">
                        <el-option label="未明确" value="unspecified" />
                        <el-option label="停电" value="outage" />
                        <el-option label="不停电" value="non_outage" />
                      </el-select>
                    </el-form-item>
                    <DemandAttributeFields v-model="position.attributes" :fields="complexPositionFields" />
                    <el-button
                      link
                      type="danger"
                      data-guide-action="demands.location-remove" @click="positions = positions.filter((row) => row.id !== position.id)"
                    >
                      移除该位置
                    </el-button>
                  </template>
                </el-collapse-item>
              </el-collapse>
              <el-pagination v-if="positions.length > positionDetailPageSize" class="mt-3"
                v-model:current-page="positionDetailPage" :page-size="positionDetailPageSize"
                :total="positions.length" layout="total, prev, pager, next" />
            </template>
          </section>

          <section data-demand-section="materials" class="demand-form-section"><h3>预计物资</h3>
            <div class="business-control-row mb-3">
              <el-button data-guide-action="demands.material" type="primary" @click="materialPickerOpen=true">选择预计物资</el-button>
              <NativeRecordPicker v-if="materialPickerOpen" title="选择预计物资" placeholder="搜索名称、规格或型号"
                confirm-label="添加预计物资" confirm-guide="demands.material-add-confirm"
                :columns="materialPickerColumns" :loader="loadMaterialPage" :selectable="canSelectMaterial"
                :saving="loadingMaterial" @close="materialPickerOpen=false" @confirm="addMaterials"/>
            </div>
            <BusinessWorksheet v-if="materials.length" ref="materialSheet" data-grid-key="demands:materials"
              name="预计物资" :session-key="materialSession"
              :rows="materialRows" :columns="materialColumns" :validate="validateMaterial"
              :disabled="saving" @change="updateMaterial" />
            <div class="flex flex-wrap gap-2 mt-3">
              <el-button v-for="item in materials" :key="item.id" link type="danger"
                data-guide-action="demands.material-remove"
                @click="materials = materials.filter(row => row.id !== item.id)">移除 {{ item.label }}</el-button>
            </div>
          </section>

          <section data-demand-section="sources" class="demand-form-section"><h3>需求来源</h3>
            <el-table
              v-if="record?.sources.length"
              :data="record.sources"
              row-key="id"
              border
              class="mb-3"
            >
              <el-table-column prop="description" label="已有来源" min-width="180" />
              <el-table-column prop="discovered_on" label="发现日期" width="135" />
            </el-table>
            <el-form-item data-guide-action="demands.source" label="补充来源说明">
              <el-input v-model="form.source" type="textarea" />
            </el-form-item>
            <el-form-item v-if="form.source" label="发现日期">
              <el-date-picker v-model="form.discovery" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
          </section>
        </el-form>
      </div>
    </el-card>

    <el-dialog
      v-model="duplicateOpen"
      title="核对疑似重复需求"
      append-to-body
      width="min(94vw, 825px)"
      :close-on-click-modal="false"
    >
      <el-table :data="duplicates" row-key="id" border max-height="300">
        <el-table-column prop="demand_no" label="需求编号" min-width="122" />
        <el-table-column prop="problem_description" label="正式问题描述" min-width="190" />
        <el-table-column prop="display_status" label="需求状态" width="106" />
        <el-table-column label="正式作业位置" min-width="170">
          <template #default="{ row }">
            <div v-for="position in row.work_locations" :key="position.item_no">
              <div>作业位置：{{ locationDisplayFields(position.location_kind,position.location_snapshot_json).location_label }}</div>
              <div v-if="position.location_kind==='span'">起点杆塔号：{{locationDisplayFields(position.location_kind,position.location_snapshot_json).start_tower_no}}</div>
              <div v-if="position.location_kind==='span'">终点杆塔号：{{locationDisplayFields(position.location_kind,position.location_snapshot_json).end_tower_no}}</div>
              <div>数量：{{ formatScaledDecimal(position.quantity_scaled, 4) }}</div>
              <div>单位：{{ row.unit_snapshot }}</div>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-form label-position="top" novalidate class="mt-3">
        <el-form-item data-guide-action="demands.duplicate-check" label="保留独立需求的依据" required>
          <el-input v-model="duplicateReason" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" data-guide-action="demands.duplicate-back" @click="duplicateOpen = false">返回编辑</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!duplicateReason.trim()"
          data-guide-action="demands.duplicate-save" @click="persist(true)"
        >
          独立保留并保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { equipmentStatus } from "../../../../server/shared/equipment-bulk";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import DemandTowerQuickPicker from "@/components/business/DemandTowerQuickPicker.vue";
import NativeRecordPicker from "@/components/business/NativeRecordPicker.vue";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetValues, WorksheetIssue } from "@/components/BusinessWorksheet/univer-engine";
import { validateAttributeValue } from "../../../../server/shared/operation-attributes";
import { useUserStore } from "@/stores/user";
import { randomRequestId } from "@/utils/business/request-id";
import DemandAttributeFields from "@/components/business/DemandAttributeFields.vue";
import {
  DemandRequestError,
  readDemandForEditor,
  saveDemand,
  type DemandEditorRecord,
  type DemandWriteInput,
} from "@/api/business/demands";
import {
  listStandards,
  readOperationDefinition,
  type WorkStandardRow,
} from "@/api/business/standards";
import { listEquipment, type EquipmentKind, type EquipmentRow } from "@/api/business/equipment";
import { locationDisplayFields } from "../../../../server/shared/location-display";
import { queryMaterials, readMaterial, type Material } from "@/api/business/materials";
import {
  dictionaryDetail,
  listDictionaries,
  readDictionary,
  type DictionaryRow,
} from "@/api/business/dictionaries";
import {
  exactScaledDecimalText,
  formatScaledDecimal,
  quantityFitsUnitPrecision,
} from "@/utils/business/fixed-scale";
import type { OperationRecord } from "../../../../server/shared/types/work-standards";
import type { DemandLocationInput } from "../../../../server/shared/types/demands";
import type {
  AttributeValues,
  OperationAttribute,
} from "../../../../server/shared/types/operation-attributes";

interface Position {
  id: string;
  label: string;
  line: string;
  startTower: string;
  endTower: string;
  physicalCode: string;
  quantity: string;
  specification: string;
  workMode: NonNullable<DemandLocationInput["work_mode"]>;
  attributes: AttributeValues;
  location: DemandLocationInput;
}
interface ExpectedMaterial {
  id: string;
  label: string;
  model: string;
  materialSpecification: string;
  unit: string;
  quantity: string;
  note: string;
  original?: number;
  precision?: number;
}
const kindLabel = { physical_tower: "物理杆塔", logical_tower: "逻辑杆塔", span: "档距" };
const catalogs: Record<DemandLocationInput["location_kind"], EquipmentKind> = {
  physical_tower: "physical",
  logical_tower: "towers",
  span: "spans",
};
const route = useRoute(),
  router = useRouter();
const user = useUserStore();
const canConfigure = computed(() => user.userInfo.perms.includes("admin"));
const loadFailed = ref(false);
const demandScroll = ref<HTMLElement>();
const sections = ["basic", "positions", "materials", "sources"] as const;
const section = ref<string>("basic"),
  loading = ref(false),
  saving = ref(false),
  error = ref("");
function navigateSection(name: string | number) {
  const key=String(name);
  if(!sections.some(item=>item===key))return;
  section.value=key;
  const scroll=demandScroll.value;
  const target=scroll?.querySelector<HTMLElement>(`[data-demand-section="${key}"]`);
  const nav=scroll?.querySelector<HTMLElement>(".demand-section-nav");
  if(!scroll||!target||!nav)return;
  scroll.scrollTop+=target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-nav.offsetHeight;
}
function syncSection() {
  const scroll=demandScroll.value;
  if(!scroll)return;
  const nav=scroll.querySelector<HTMLElement>(".demand-section-nav");
  if(!nav)return;
  const boundary=scroll.getBoundingClientRect().top+nav.offsetHeight+2;
  let active:string=sections[0];
  for(const key of sections){
    const target=scroll.querySelector<HTMLElement>(`[data-demand-section="${key}"]`);
    if(target&&target.getBoundingClientRect().top<=boundary)active=key;
  }
  if(scroll.scrollTop>0&&scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<=2)active="sources";
  section.value=active;
}
const setupMissing = ref(false),
  loadingOperations = ref(false),
  loadingMaterial = ref(false);
const record = ref<DemandEditorRecord>(),
  operation = ref<OperationRecord>(),
  precision = ref<number>();
const operations = ref<WorkStandardRow[]>([]),
  priorities = ref<DictionaryRow[]>([]);
const kind = ref<DemandLocationInput["location_kind"]>("physical_tower");
const positionPickerOpen = ref(false), quickPickerOpen = ref(false), materialPickerOpen = ref(false);
const expandedPositions = ref<(string | number)[]>([]);
const positionDetailPage = ref(1);
const positionDetailPageSize = 20;
const positions = ref<Position[]>([]),
  materials = ref<ExpectedMaterial[]>([]);
const duplicates = ref<DemandEditorRecord[]>([]),
  duplicateOpen = ref(false),
  duplicateReason = ref("");
const form = reactive({
  problem: "",
  target: "",
  completion: "",
  reason: "",
  source: "",
  expectedOn: null as string | null,
  priority: null as string | null,
  discovery: null as string | null,
  attributes: {} as AttributeValues,
});
let baseline = "",
  pageRequest = 0,
  operationRequest = 0,
  operationSearch = 0;

const fields = computed<OperationAttribute[]>(() =>
  (JSON.parse(operation.value?.attributes_schema_json || "[]") as OperationAttribute[]).filter(
    (field) => field.enabled,
  ),
);
const demandFields = computed(() => fields.value.filter((field) => field.scope === "demand"));
const positionFields = computed(() => fields.value.filter((field) => field.scope === "location"));
const positionKinds = computed<DemandLocationInput["location_kind"][]>(() =>
  operation.value?.attribution_unit === "physical_tower"
    ? ["physical_tower"]
    : operation.value?.object_position === "corridor"
      ? ["logical_tower", "span"]
      : ["logical_tower"],
);
const positionSheet = ref<InstanceType<typeof BusinessWorksheet>>();
const materialSheet = ref<InstanceType<typeof BusinessWorksheet>>();
function attributeOptions(field:OperationAttribute):string[]|undefined{
  if(field.type==="boolean")return ["是","否"];
  if(field.type==="select"||field.type==="multiselect")return field.options.map(option=>option.label);
}
function worksheetAttribute(field:OperationAttribute){
  if(field.source!=="manual")return false;
  const labels=attributeOptions(field);
  // Ambiguous labels or labels containing native list delimiters use the original
  // per-position Element Plus form, not an unsafe composite label.
  return !labels||(new Set(labels).size===labels.length&&labels.every(label=>!label.includes(",")&&(field.type!=="multiselect"||!label.includes("/"))));
}
const scalarPositionFields = computed(() => positionFields.value.filter(worksheetAttribute));
function attributeText(field:OperationAttribute,value:AttributeValues[string]|undefined):string{
  if(value===undefined)return "";
  if(field.type==="boolean")return value===true?"是":value===false?"否":String(value);
  if(field.type==="select"||field.type==="multiselect"){
    const label=(v:unknown)=>field.options.find(option=>option.value===v)?.label??String(v);
    return Array.isArray(value)?value.map(label).join("/"):label(value);
  }
  return String(value);
}
function attributeInput(field:OperationAttribute,raw:string):AttributeValues[string]{
  if(field.type==="integer")return validateAttributeValue(field,exactScaledDecimalText(raw,0));
  if(field.type==="boolean")return validateAttributeValue(field,raw==="是"?true:raw==="否"?false:raw);
  if(field.type==="select"||field.type==="multiselect"){
    const code=(label:string)=>{
      const matches=field.options.filter(option=>option.label===label);
      if(matches.length!==1)throw Error(field.label+"不在正式选项中");
      return matches[0].value;
    };
    return validateAttributeValue(field,field.type==="select"?code(raw):raw.split("/").map(code));
  }
  return validateAttributeValue(field,raw);
}
const complexPositionFields = computed(() => positionFields.value.filter(field =>
  !scalarPositionFields.value.some(item => item.key === field.key)));
const positionSession = computed(() => JSON.stringify([operation.value?.id, operation.value?.version, positions.value.map(row=>row.id)]));
const materialSession = computed(() => JSON.stringify(materials.value.map(row=>row.id)));
const visiblePositionDetails = computed(() => {
  const start = (positionDetailPage.value - 1) * positionDetailPageSize;
  return positions.value.slice(start, start + positionDetailPageSize);
});
watch(() => positions.value.length, count => {
  positionDetailPage.value = Math.min(positionDetailPage.value, Math.max(1, Math.ceil(count / positionDetailPageSize)));
});
const positionRows = computed(() => positions.value.map(row => ({
  id: row.id, label: row.label, values: {
    label: row.label, line: row.line, quantity: row.quantity, specification: row.specification,
    startTower:row.startTower,endTower:row.endTower,physicalCode:row.physicalCode,
    ...Object.fromEntries(scalarPositionFields.value.map(field => ["attribute:"+field.key,attributeText(field,row.attributes[field.key])])),
  },
})));
const materialRows = computed(() => materials.value.map(row => ({
  id: row.id,label: row.label,values:{label:row.label,unit:row.unit,quantity:row.quantity,note:row.note,model:row.model,materialSpecification:row.materialSpecification},
})));
const total = computed(() => positions.value.reduce((sum,row)=>sum+(exactScaledDecimalText(row.quantity,4)||0),0));
const positionColumns = computed<WorksheetColumn[]>(()=>[
  {key:"label",title:"作业位置",width:180},
  {key:"line",title:"线路",width:145},
  {key:"quantity",title:"需求数量",width:125,editable:true,numeric:true},
  {key:"specification",title:"设备规格",width:170,editable:true},
  ...scalarPositionFields.value.map(field=>({key:"attribute:"+field.key,title:field.label,width:160,editable:true,numeric:field.type==="integer"||field.type==="decimal",options:attributeOptions(field),multiple:field.type==="multiselect",required:field.requirement==="save"})),
  ...(positions.value.some(row=>row.location.location_kind==="span")?[{key:"startTower",title:"起点杆塔号",width:125},{key:"endTower",title:"终点杆塔号",width:125}]:[]),
  ...(positions.value.some(row=>row.location.location_kind==="physical_tower")?[{key:"physicalCode",title:"物理杆塔编号",width:150}]:[]),
]);
const materialColumns: WorksheetColumn[] = [
  {key:"label",title:"物资名称",width:180},
  {key:"unit",title:"单位",width:95},
  {key:"quantity",title:"预计数量",width:125,editable:true,numeric:true},
  {key:"note",title:"说明",width:150,editable:true},
  {key:"model",title:"物资型号",width:140},
  {key:"materialSpecification",title:"物资规格",width:140},
];

function formState() {
  return JSON.stringify([operation.value?.id, form, positions.value, materials.value]);
}
function dirty() {
  return Boolean(baseline && baseline !== formState());
}
async function guardExit() {
  if (saving.value) return false;
  await positionSheet.value?.finishEditing();
  await materialSheet.value?.finishEditing();
  if (!dirty()) return true;
  try {
    await ElMessageBox.confirm("专业需求有未保存的修改，确定离开？", "离开需求编辑", {
      type: "warning",
      confirmButtonText: "放弃修改",
      cancelButtonText: "继续编辑",
    });
    return true;
  } catch {
    return false;
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty() && !saving.value && !positionSheet.value?.changed() && !materialSheet.value?.changed()) return;
  event.preventDefault();
  event.returnValue = true;
}
const setupToken = computed(() => typeof route.query.resumeDemand === "string" &&
  /^[0-9a-f]{32}$/.test(route.query.resumeDemand) ? route.query.resumeDemand : undefined);
function setupStorageKey(token: string) {
  return "sd-demand-setup/" + user.userInfo.userId + "/" + token;
}
async function openSetup() {
  if (operation.value || record.value || !canConfigure.value) return;
  const token = setupToken.value || randomRequestId();
  const original = baseline;
  try {
    sessionStorage.setItem(setupStorageKey(token), JSON.stringify(form));
    baseline = formState();
    const failure = await router.push({ name: "Operations", query: { resumeDemand: token, setupTab: "operations" } });
    if (failure) baseline = original;
  } catch (cause) {
    baseline = original;
    error.value = (cause as Error).message;
  }
}
function restoreSetup() {
  const token = setupToken.value;
  if (!token || record.value) return;
  const raw = sessionStorage.getItem(setupStorageKey(token));
  if (!raw) return;
  const saved = JSON.parse(raw) as Partial<typeof form>;
  for (const key of ["problem", "target", "completion", "reason", "source"] as const) {
    if (typeof saved[key] === "string") form[key] = saved[key];
  }
  for (const key of ["expectedOn", "priority", "discovery"] as const) {
    if (typeof saved[key] === "string") form[key] = saved[key];
  }
  ElMessage.info("已恢复专业需求草稿");
}
function returnToList(id?: string) {
  const { resumeDemand: _resumeDemand, ...query } = route.query;
  if (id && setupToken.value) sessionStorage.removeItem(setupStorageKey(setupToken.value));
  return router.push({ name: "Demands", query: { ...query, ...(id ? { demand: id } : {}) } });
}
async function unitPrecision(id: string, version: number) {
  const value = (await dictionaryDetail("units", id)).versions.find(
    (row) => row.version === version,
  )?.quantity_precision;
  if (value === undefined || !quantityFitsUnitPrecision(0, value))
    throw Error("所采用的正式计量单位缺少有效数量精度");
  return value;
}
function defaults(schema: OperationAttribute[]) {
  return Object.fromEntries(
    schema.flatMap((field) =>
      field.source === "manual" && field.default_value !== undefined
        ? [[field.key, field.default_value]]
        : [],
    ),
  );
}
async function searchOperations(keyword: string) {
  const seq = ++operationSearch;
  loadingOperations.value = true;
  try {
    const result = await listStandards("operations", { keyword, size: 30 });
    if (seq === operationSearch) {
      operations.value = result.items.filter((row) => row.status === "active" && !row.deleted);
      if (!keyword) setupMissing.value = operations.value.length === 0;
    }
  } catch (cause) {
    if (seq === operationSearch) error.value = (cause as Error).message;
  } finally {
    if (seq === operationSearch) loadingOperations.value = false;
  }
}
async function chooseOperation(id: string) {
  if (!id || operation.value?.id === id) return;
  const replacingOperation = Boolean(operation.value);
  if (positions.value.length) {
    try {
      await ElMessageBox.confirm(
        "切换操作类型会重新选择作业位置，并使用新版录入模板。",
        "切换操作类型",
        { type: "warning" },
      );
    } catch {
      return;
    }
  }
  const seq = ++operationRequest;
  loading.value = true;
  error.value = "";
  try {
    const data = await readOperationDefinition(id);
    const places = await unitPrecision(data.default_unit_id, data.default_unit_version);
    if (seq !== operationRequest) return;
    operation.value = data;
    precision.value = places;
    if (replacingOperation || !form.target.trim()) form.target = data.default_target_object;
    if (replacingOperation || !form.completion.trim()) form.completion = data.completion_standard || "";
    form.attributes = defaults(demandFields.value);
    expandedPositions.value = [];
    positionDetailPage.value = 1;
    positions.value = [];
    kind.value = positionKinds.value[0];
    resetPositionSearch();
  } catch (cause) {
    if (seq === operationRequest) error.value = (cause as Error).message;
  } finally {
    if (seq === operationRequest) loading.value = false;
  }
}
function deviceLabel(row: EquipmentRow) {
  return row.label || row.display_name || row.asset_no || row.name || row.tower_no || "未命名设备";
}
const positionPickerColumns = computed<{key:keyof EquipmentRow;label:string;width?:number;format?:(row:EquipmentRow)=>string}[]>(()=>[
  ...(kind.value==="physical_tower"?[
    {key:"asset_no" as const,label:"现场铭牌",width:150},{key:"tower_code" as const,label:"物理杆塔编号",width:150},{key:"tower_material_label" as const,label:"杆塔材质"},{key:"model" as const,label:"型号"}
  ]:kind.value==="span"?[
    {key:"line_id_label" as const,label:"线路",width:180},{key:"start_tower_no" as const,label:"起点杆塔号"},{key:"end_tower_no" as const,label:"终点杆塔号"}
  ]:[{key:"line_id_label" as const,label:"线路",width:180},{key:"voltage_level_name" as const,label:"电压等级"},{key:"tower_no" as const,label:"杆塔号"},{key:"logical_code" as const,label:"逻辑杆塔编号"}]),
  {key:"status",label:"状态",format:row=>equipmentStatus(row.status)},
]);
const materialPickerColumns: {key:keyof Material;label:string;width?:number}[] = [
  {key:"code",label:"编号"},{key:"name",label:"物资名称",width:180},{key:"model",label:"型号"},
  {key:"specification",label:"规格"},{key:"unit_id_label",label:"单位"},{key:"version_no",label:"版本"},
];
function resetPositionSearch(){positionPickerOpen.value=false;quickPickerOpen.value=false;}
function loadPositionPage(keyword:string,page:number){return listEquipment(catalogs[kind.value],{keyword,page,size:20});}
function canSelectPosition(row:EquipmentRow){return !row.deleted&&!["retired","inactive"].includes(row.status)&&!positions.value.some(item=>item.id===kind.value+":"+row.id);}
function loadMaterialPage(keyword:string,page:number){return queryMaterials({keyword,page,pageSize:20,status:"active"});}
function canSelectMaterial(row:Material){return !row.deleted&&row.status==="active"&&!materials.value.some(item=>item.id===row.id);}
async function addQuickPositions(selected:EquipmentRow[],lineId:string) {
  await addPositions(selected,lineId);
  quickPickerOpen.value=false;
}
async function addPositions(selected:EquipmentRow[],contextLineId?:string) {
  await positionSheet.value?.finishEditing();
  const type=kind.value;
  const additions=[...new Map(selected.filter(canSelectPosition).map(row=>[row.id,row])).values()];
  if(positions.value.length+additions.length>5000){ElMessage.error("一条需求最多5000处作业位置");return;}
  for(const row of additions){
    const id=row.id;
    if(!canSelectPosition(row))continue;
    const locationKey =
      type === "physical_tower"
        ? "physical_tower_id"
        : type === "logical_tower"
          ? "logical_tower_id"
          : "span_id";
    positions.value.push({
      id: type + ":" + id,
      label: deviceLabel(row),
      line: row.line_id_label || row.line_name || row.bindings?.find(b=>b.line_id===contextLineId)?.line_name || "",
      startTower:row.start_tower_no||"",endTower:row.end_tower_no||"",physicalCode:row.tower_code||"",
      quantity: formatScaledDecimal(operation.value?.default_quantity_scaled, 4),
      specification: "",
      location: {
        location_kind: type,
        [locationKey]: id,
        ...(type === "span" ? { span_version: row.version } : {}),
        ...(type === "physical_tower" && contextLineId ? {context_line_id:contextLineId} : {}),
        quantity_scaled: 0,
      },
      workMode: "unspecified",
      attributes: defaults(positionFields.value),
    });
  }
  positionPickerOpen.value=false;
}
async function addMaterials(selected:Material[]) {
  await materialSheet.value?.finishEditing();
  if(loadingMaterial.value)return;
  loadingMaterial.value=true;
  try{
    const additions=await Promise.all(selected.filter(canSelectMaterial).map(async row=>{
      const unit=await readDictionary("units",row.unit_id);
      return {id:row.id,label:row.name,model:row.model||"",materialSpecification:row.specification||"",unit:unit.name,quantity:"1",note:"",precision:await unitPrecision(unit.id,unit.version)};
    }));
    materials.value.push(...additions);
    materialPickerOpen.value=false;
  }catch(cause){ElMessage.error((cause as Error).message);}
  finally{loadingMaterial.value=false;}
}
async function loadMaterialPrecisions() {
  if (loadingMaterial.value) return;
  loadingMaterial.value = true;
  try {
    const lookup = new Map<string, Promise<number>>();
    await Promise.all(
      materials.value
        .filter((row) => row.precision === undefined)
        .map(async (row) => {
          try {
            const material = await readMaterial(row.id);
            let places = lookup.get(material.unit_id);
            if (!places) {
              places = readDictionary("units", material.unit_id).then((unit) =>
                unitPrecision(unit.id, unit.version),
              );
              lookup.set(material.unit_id, places);
            }
            row.precision = await places;
          } catch {
            /* Existing quantities remain valid when the material cannot be newly adopted. */
          }
        }),
    );
  } finally {
    loadingMaterial.value = false;
  }
}
function quantity(input: string, places: number | undefined, label: string, original?: number) {
  const value = exactScaledDecimalText(input, 4);
  if (
    value === null ||
    value <= 0 ||
    (value !== original && !quantityFitsUnitPrecision(value, places ?? -1))
  )
    throw Error(label + "应填写大于 0 且符合正式计量单位精度的数量");
  return value;
}
function worksheetIssue(row:number,column:number,rowId:string,field:string,location:string,cause:unknown):WorksheetIssue {
  let letters=""; for(let n=column+1;n>0;n=Math.floor((n-1)/26))letters=String.fromCharCode(65+(n-1)%26)+letters;
  const message = cause instanceof Error ? cause.message : String(cause);
  return {row,column,cell:letters+(row+1),rowId,field,location,message};
}
function validatePositions(values:WorksheetValues):WorksheetIssue[] {
  const issues:WorksheetIssue[]=[];
  positions.value.forEach((row,index)=>{
    const raw=values[row.id]||{};
    try { quantity(raw.quantity??"",precision.value,"位置数量"); }
    catch(cause){issues.push(worksheetIssue(index+1,2,row.id,"quantity",row.label,cause));}
    scalarPositionFields.value.forEach((field,i)=>{
      const key="attribute:"+field.key, text=raw[key]??"";
      try {
        if (!text.trim()) { if(field.requirement==="save") throw Error(field.label+"不能为空"); return; }
        attributeInput(field,text);
      }catch(cause){issues.push(worksheetIssue(index+1,i+4,row.id,key,row.label,cause));}
    });
  });
  return issues;
}
function validateMaterial(values:WorksheetValues):WorksheetIssue[] {
  const issues:WorksheetIssue[]=[];
  materials.value.forEach((row,index)=>{
    try { quantity(values[row.id]?.quantity??"",row.precision,"物资数量",row.original); }
    catch(cause){issues.push(worksheetIssue(index+1,2,row.id,"quantity",row.label,cause));}
  });
  return issues;
}
function updatePosition(values:WorksheetValues) {
  for(const row of positions.value){
    const fields=values[row.id]; if(!fields)continue;
    row.quantity=fields.quantity??""; row.specification=fields.specification??"";
    for(const field of scalarPositionFields.value){
      const value=fields["attribute:"+field.key]??"";
      if(value==="")delete row.attributes[field.key];
      else if(attributeText(field,row.attributes[field.key])!==value){
        try{row.attributes[field.key]=attributeInput(field,value)}catch{row.attributes[field.key]=value}
      }
    }
  }
}
function updateMaterial(values:WorksheetValues) {
  for(const row of materials.value){
    const fields=values[row.id]; if(!fields)continue;
    row.quantity=fields.quantity??"";row.note=fields.note??"";
  }
}
function attributesForSave(values: AttributeValues, schema: OperationAttribute[]) {
  const output: AttributeValues = {};
  for (const field of schema) {
    const value = values[field.key];
    if (field.source === "asset" || value === undefined) continue;
    if (field.type === "integer") {
      const parsed = exactScaledDecimalText(String(value), 0);
      if (parsed === null) throw Error(field.label + "必须填写整数");
      output[field.key] = parsed;
    } else output[field.key] = value;
  }
  return output;
}
function command(separate: boolean): DemandWriteInput {
  if (!operation.value) throw Error("请选择操作类型");
  if (!form.problem.trim() || !form.completion.trim()) {
    navigateSection("basic");
    throw Error("请填写问题描述和验收标准");
  }
  const current = record.value;
  return {
    operation_id: operation.value.id,
    operation_version: operation.value.version,
    expected_version: current?.current_version,
    reason: form.reason.trim(),
    problem_description: form.problem.trim(),
    target_object: form.target.trim(),
    completion_standard: form.completion.trim(),
    priority_id: form.priority || null,
    expected_on: form.expectedOn || null,
    attributes: attributesForSave(form.attributes, demandFields.value),
    work_locations: positions.value.map((row) => ({
      ...row.location,
      specification: row.specification,
      work_mode: row.workMode,
      quantity_scaled: quantity(row.quantity, precision.value, row.label + "的"),
      attributes: attributesForSave(row.attributes, positionFields.value),
    })),
    materials: materials.value.map((row) => ({
      material_id: row.id,
      quantity_scaled: quantity(row.quantity, row.precision, row.label + "的", row.original),
      note: row.note,
    })),
    ...(form.source.trim()
      ? { sources: [{ description: form.source.trim(), discovered_on: form.discovery }] }
      : {}),
    ...(separate
      ? {
          duplicate_decision: "separate",
          duplicate_reason: duplicateReason.value.trim(),
          duplicate_matches: duplicates.value.map((row) => row.demand_no),
          duplicate_review_tokens: Object.fromEntries(
            duplicates.value.map((row) => [row.id, row.duplicate_review_token]),
          ),
        }
      : {}),
  };
}
async function persist(separate = false) {
  if (loadFailed.value) return;
  if (saving.value || !positions.value.length) return;
  saving.value = true;
  error.value = "";
  let savedId = "";
  try {
    await loadMaterialPrecisions();
    const p = await positionSheet.value?.prepareSave();
    const m = await materialSheet.value?.prepareSave();
    if (positions.value.length && !p) { navigateSection("positions"); throw Error("请检查作业位置工作表"); }
    if (materials.value.length && !m) { navigateSection("materials"); throw Error("请检查预计物资工作表"); }
    const saved = await saveDemand(command(separate), record.value?.id);
    savedId = saved.id;
    duplicateOpen.value = false;
    baseline = formState();
    ElMessage.success("专业需求已保存");
  } catch (cause) {
    if (cause instanceof DemandRequestError && cause.duplicateIds.length) {
      try {
        duplicates.value = await Promise.all(cause.duplicateIds.map(readDemandForEditor));
        duplicateOpen.value = true;
      } catch (failure) {
        error.value = (failure as Error).message;
      }
    } else error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
  if (savedId) await returnToList(savedId);
}
async function load() {
  const seq = ++pageRequest;
  const id = typeof route.params.demandId === "string" ? route.params.demandId : "";
  baseline = "";
  error.value = "";
  loadFailed.value = false;
  loading.value = true;
  navigateSection("basic");
  if (id) {
    // Revision already has work positions. Start loading the engine alongside the
    // editor data; the mounted worksheet owns the visible retry state.
    void import("@/components/BusinessWorksheet/univer-engine").catch(() => {});
  }
  try {
    const [old, availablePriorities] = await Promise.all([
      id ? readDemandForEditor(id) : Promise.resolve(undefined),
      listDictionaries("priorities", { size: 200 }),
    ]);
    const definition = old
      ? await readOperationDefinition(old.operation_id, old.operation_version)
      : undefined;
    const places = definition
      ? await unitPrecision(definition.default_unit_id, definition.default_unit_version)
      : undefined;
    if (seq !== pageRequest) return;
    record.value = old;
    operation.value = definition;
    precision.value = places;
    priorities.value = availablePriorities.items.filter(
      (row) => !row.deleted && (row.status === "active" || row.id === old?.priority_id),
    );
    Object.assign(form, {
      problem: old?.problem_description || "",
      target: old?.target_object || "",
      completion: old?.completion_standard || "",
      expectedOn: old?.expected_on || null,
      priority: old?.priority_id || null,
      attributes: { ...old?.attributes },
      reason: "",
      source: "",
      discovery: null,
    });
    expandedPositions.value = [];
    positionDetailPage.value = 1;
    positions.value = (old?.work_locations || []).map((row) => ({
      id: row.location_kind + ":" + (row.physical_tower_id || row.logical_tower_id || row.span_id),
      label: locationDisplayFields(row.location_kind,row.location_snapshot_json).location_label,
      line: row.location_snapshot_json.line_name,
      startTower:locationDisplayFields(row.location_kind,row.location_snapshot_json).start_tower_no,
      endTower:locationDisplayFields(row.location_kind,row.location_snapshot_json).end_tower_no,
      physicalCode:row.location_snapshot_json.physical_code||"",
      quantity: formatScaledDecimal(row.quantity_scaled, 4),
      specification: row.location_snapshot_json.specification,
      workMode: row.work_mode,
      attributes: { ...row.attributes },
      location: {
        location_kind: row.location_kind,
        quantity_scaled: row.quantity_scaled,
        logical_tower_id: row.logical_tower_id,
        physical_tower_id: row.physical_tower_id,
        span_id: row.span_id,
        span_version: row.span_version,
        context_line_id: row.context_line_id,
      },
    }));
    materials.value = (old?.materials || []).map((row) => ({
      id: row.material_id,
      label: row.material_name,
      model:row.model||"",materialSpecification:row.specification||"",
      unit: row.unit_snapshot,
      quantity: formatScaledDecimal(row.quantity_scaled, 4),
      note: row.note,
      original: row.quantity_scaled,
    }));
    if (definition) {
      operations.value = [{ ...definition }];
      kind.value = positionKinds.value[0];
      resetPositionSearch();
    } else void searchOperations("");
    await loadMaterialPrecisions();
    baseline = formState();
    restoreSetup();
  } catch (cause) {
    if (seq === pageRequest) {
      error.value = (cause as Error).message;
      loadFailed.value = true;
    }
  } finally {
    if (seq === pageRequest) loading.value = false;
  }
}
onBeforeRouteLeave(guardExit);
onBeforeRouteUpdate(guardExit);
watch(
  () => [route.name, route.params.demandId, route.query.resumeDemand],
  ([name]) => {
    if (name === "DemandEditor") void load();
  },
  { immediate: true },
);
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  ++pageRequest;
  ++operationRequest;
  ++operationSearch;
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<style scoped lang="scss">
.demand-editor-card :deep(.el-card__body) { display: flex; flex-direction: column; }
.demand-editor-card :deep(.el-card__body > .el-alert) { flex-shrink: 0; }
.demand-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scroll-padding-top: 48px; }
.demand-section-nav { position: sticky; top: 0; z-index: 5; background: var(--el-bg-color); }
.demand-section-nav :deep(.el-tabs__header) { margin: 0; }
.demand-section-nav :deep(.el-tabs__content) { display: none; }
.demand-form-section { padding: 20px 0; border-bottom: 1px solid var(--el-border-color-light); }
.demand-form-section > h3 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
.demand-form-section:last-child { min-height: calc(100vh - 240px); border-bottom: 0; }
</style>
