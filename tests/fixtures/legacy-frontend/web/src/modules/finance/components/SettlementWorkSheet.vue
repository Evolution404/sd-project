<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import BusinessDraftGrid, { type DraftGridColumn, type DraftGridEdit, type DraftGridRow } from "../../../shared/ui/BusinessDraftGrid.vue";
import { api } from "../../../shared/api/client";
import { exactScaledDecimalText, formatScaledDecimal, quantityFitsUnitPrecision } from "../../../shared/utils/fixed-scale";
import type { SettlementResolutionInput } from "../../../../../server/shared/types/finance-workflows";

export interface WorkPosition {
  id: string;
  project_scope_id: string;
  demand_id: string;
  demand_no: string;
  problem_description: string;
  demand_location_id: string;
  location_item_no: number | null;
  approved_quantity_scaled: number;
  prior_resolved_quantity_scaled: number;
  remaining_quantity_scaled: number;
  line_name: string | null;
  location_label: string;
  unit_id: string;
  unit_version: number;
  unit: string;
  precision: number | null;
  editable: boolean;
}
interface Worksheet { approval_version_no: number; rows: WorkPosition[] }
interface Entry { quantity: string; evidence: string; persisted: boolean }
const props = defineProps<{
  projectId: string;
  approvalId?: string;
  settlementId?: string;
  resolutions: ReadonlyArray<Partial<SettlementResolutionInput>>;
}>();
const emit = defineEmits<{
  "update:resolutions": [resolutions: SettlementResolutionInput[]];
  "validity-change": [valid: boolean];
}>();
const loading = ref(false);
const error = ref("");
const data = ref<WorkPosition[]>([]);
const entries = ref<Record<string, Entry>>({});
const justFilled = ref(false);
const grid = ref<InstanceType<typeof BusinessDraftGrid> | null>(null);
const activeVersion = ref("");
let requestId = 0;
let initialized = false;
const rowById = computed(() => new Map(data.value.map(row => [row.id,row])));
const columns: DraftGridColumn[] = [
  { field:"demand_no",title:"需求编号",minWidth:145,frozen:true },
  { field:"problem_description",title:"需求描述",minWidth:220 },
  { field:"line_name",title:"线路",minWidth:145 },
  { field:"location_label",title:"作业位置",minWidth:185 },
  { field:"unit",title:"单位",minWidth:78 },
  { field:"approved_text",title:"批准量",minWidth:95 },
  { field:"prior_text",title:"此前生效解决量",minWidth:135 },
  { field:"remaining_text",title:"批准余量",minWidth:115 },
  { field:"quantity_text",title:"本次解决量",minWidth:145,editable:true },
  { field:"evidence",title:"完成依据",minWidth:205,editable:true },
  { field:"status",title:"可填写范围",minWidth:160 },
];
const visible = computed(() => data.value.filter(row => !justFilled.value || Boolean(entries.value[row.id])));
const rows = computed<DraftGridRow[]>(() => visible.value.map(row => {
  const entry = entries.value[row.id];
  const thisTime = exactScaledDecimalText(entry?.quantity ?? "0",4) ?? 0;
  const exceeded = row.editable && thisTime > row.remaining_quantity_scaled;
  return {
    id:row.id,name:row.demand_no+" · "+row.location_label,
    demand_no:row.demand_no,problem_description:row.problem_description,
    line_name:row.line_name || "—",location_label:row.location_label,
    unit:row.unit,approved_text:formatScaledDecimal(row.approved_quantity_scaled,4),
    prior_text:formatScaledDecimal(row.prior_resolved_quantity_scaled,4),
    remaining_text:formatScaledDecimal(row.remaining_quantity_scaled,4),
    quantity_text:entry?.quantity ?? "0", evidence:entry?.evidence ?? "",
    status:!row.editable ? "未纳入所选批准版本"
      : exceeded ? "超出余量 "+formatScaledDecimal(thisTime-row.remaining_quantity_scaled,4)
      : "可填写",
  };
}));
function validateOne(row: WorkPosition, field: string, text: string): string | null {
  if (!row.editable || row.location_item_no === null) return "位置未纳入所选正式批准版本，不可填写";
  if (field !== "quantity_text") return null;
  const parsed = exactScaledDecimalText(text.trim(),4);
  if (parsed === null || parsed < 0) return row.demand_no+"："+row.location_label+"的数量格式无效，应填写非负数，最多四位小数";
  if (!quantityFitsUnitPrecision(parsed,row.precision ?? -1))
    return row.demand_no+"："+row.location_label+"须按冻结单位"+row.unit+"的"+(row.precision === null ? "有效数量精度" : row.precision+"位小数精度")+"填写";
  return null;
}
function validateBatch(edits: readonly DraftGridEdit[]): string | null {
  for(const edit of edits) {
    const row = rowById.value.get(edit.id);
    const failure = row ? validateOne(row,edit.field,edit.after) : "粘贴包含未知作业位置";
    if (failure) return failure+"；整块粘贴未应用";
  }
  return null;
}
function writable(id: string,field: string) {
  return (field === "quantity_text" || field === "evidence") &&
    Boolean(rowById.value.get(id)?.editable);
}
const errors = computed<Record<string,string>>(() => {
  const output: Record<string,string> = {};
  for(const row of data.value) {
    const entry = entries.value[row.id];
    if (!entry) continue;
    const message = validateOne(row,"quantity_text",entry.quantity);
    if (message) output[row.id]=message;
  }
  return output;
});
const valid = computed(() => !loading.value && !error.value && !!activeVersion.value &&
  Object.keys(errors.value).length === 0);
watch(valid, value => emit("validity-change",value), {immediate:true});
function publish() {
  const values: SettlementResolutionInput[] = [];
  for(const row of data.value) {
    const entry = entries.value[row.id];
    if (!entry || !row.editable || row.location_item_no === null) continue;
    const parsed = exactScaledDecimalText(entry.quantity,4);
    if (parsed === null || !quantityFitsUnitPrecision(parsed,row.precision ?? -1)) continue;
    values.push({project_scope_id:row.project_scope_id,
      location_item_no:row.location_item_no,
      resolved_quantity_scaled:parsed,evidence:entry.evidence});
  }
  emit("update:resolutions",values);
}
function updateCell(id: string,field: string,value: string) {
  const row = rowById.value.get(id);
  if (!row || !writable(id,field)) return;
  const previous=entries.value[id] ?? {quantity:"0",evidence:"",persisted:false};
  entries.value={...entries.value,[id]:{...previous,
    [field === "quantity_text" ? "quantity" : "evidence"]:value}};
  publish();
}
function linkOriginal(rows: WorkPosition[]) {
  if (initialized) return;
  // Current draft/approved revision inputs are indexed in their adopted
  // frozen approval, never matched to a mutable current display row number.
  const indexes=new Map(rows.filter(row=>row.editable).map(row=>
    [row.project_scope_id+"|"+row.location_item_no,row.id]));
  const saved: Record<string,Entry> = {};
  for (const old of props.resolutions) {
    const id=indexes.get(old.project_scope_id+"|"+old.location_item_no);
    if (!id) continue;
    saved[id]={quantity:formatScaledDecimal(old.resolved_quantity_scaled ?? 0,4),
      evidence:old.evidence ?? "",persisted:true};
  }
  entries.value=saved;
  initialized=true;
}
async function fetchWorksheet(version: string): Promise<Worksheet> {
  const query = new URLSearchParams({approval_version_id:version});
  if (props.settlementId && props.settlementId !== "new") query.set("settlement_id",props.settlementId);
  return api<Worksheet>(`/projects/${props.projectId}/settlement-worksheet?${query}`);
}
async function reload() {
  const version = props.approvalId;
  if (!version) { data.value=[];error.value="尚未选择本项目正式批准版本";return; }
  const sequence=++requestId;
  loading.value=true;
  error.value="";
  try {
    const next=await fetchWorksheet(version);
    if(sequence!==requestId)return;
    linkOriginal(next.rows);
    data.value=next.rows;
    activeVersion.value=version;
    // Keep edits by immutable location identity; changed approval versions
    // submit only the subset that is writable in the adopted version.
    publish();
  } catch (failure) {
    if(sequence===requestId)error.value=(failure as Error).message;
  } finally {
    if(sequence===requestId) loading.value=false;
  }
}
watch(() => [props.projectId,props.approvalId,props.settlementId],() => {void reload();},{immediate:true});
async function previewSwitch(version:string) {
  const target=await fetchWorksheet(version);
  const writable=new Map(target.rows.filter(row=>row.editable).map(row=>[row.id,row]));
  const impacted:string[]=[];
  for(const [id,entry] of Object.entries(entries.value)) {
    const previous=rowById.value.get(id);
    const next=writable.get(id);
    if(!previous)continue;
    const quantity=exactScaledDecimalText(entry.quantity,4);
    if(!next) impacted.push(previous.demand_no+" · "+previous.location_label+"（不在目标批准版本）");
    else if(previous.unit_id!==next.unit_id || previous.unit_version!==next.unit_version ||
      previous.precision!==next.precision)
      impacted.push(previous.demand_no+" · "+previous.location_label+"（冻结单位或精度变化）");
    else if(previous.approved_quantity_scaled!==next.approved_quantity_scaled)
      impacted.push(previous.demand_no+" · "+previous.location_label+"（批准数量发生变化）");
    else if(quantity===null || !quantityFitsUnitPrecision(quantity,next.precision ?? -1))
      impacted.push(previous.demand_no+" · "+previous.location_label+"（输入不符合目标版本冻结精度）");
  }
  return impacted;
}
async function locateError() {
  const id=Object.keys(errors.value)[0];
  if(id) {
    justFilled.value=false;
    await nextTick();
    await grid.value?.focusRow(id);
    ElMessage.warning(errors.value[id]);
  } else ElMessage.success("工作量输入格式无错误");
}
const totals=computed(()=>{
  const groups=new Map<string,{unit:string;unitVersion:number;approved:number;prior:number;current:number}>();
  for(const row of data.value.filter(item=>item.editable)) {
    const key=row.unit_id+"@"+row.unit_version;
    const previous=groups.get(key)??{unit:row.unit,unitVersion:row.unit_version,approved:0,prior:0,current:0};
    previous.approved+=row.approved_quantity_scaled;
    previous.prior+=row.prior_resolved_quantity_scaled;
    previous.current+=exactScaledDecimalText(entries.value[row.id]?.quantity ?? "0",4)??0;
    groups.set(key,previous);
  }
  return [...groups.values()];
});
defineExpose({previewSwitch,reload,valid});
</script>

<template>
  <section class="settlement-work-sheet" aria-label="本次完成工作量工作表">
    <div class="toolbar settlement-work-heading">
      <div>
        <h3>本次完成工作量</h3>
        <span class="muted">当前关联位置全量展示；双击单元格填写，支持 Excel 粘贴、连续录入与撤销。0 仅为默认展示。</span>
      </div>
      <div class="toolbar">
        <ElCheckbox v-model="justFilled" label="只看已填写" />
        <ElButton size="small" data-guide-action="finance.resolution-remove" :disabled="!grid?.canUndo" @click="grid?.undo()">撤销</ElButton>
        <ElButton size="small" :disabled="!grid?.canRedo" @click="grid?.redo()">重做</ElButton>
        <ElButton size="small" @click="locateError">错误定位</ElButton>
      </div>
    </div>
    <ElAlert v-if="error" :title="'工作量位置读取失败：'+error" type="error" :closable="false">
      <ElButton :loading="loading" @click="reload">重新读取位置</ElButton>
    </ElAlert>
    <ElSkeleton v-if="loading && !data.length" :rows="4" animated />
    <template v-else>
      <p v-if="loading" class="muted">正在更新所选批准版本位置；已输入的内容保留。</p>
      <div v-if="totals.length" class="settlement-unit-summary">
        <span v-for="group in totals" :key="group.unit+'@'+group.unitVersion">
          {{ group.unit }}（版本{{ group.unitVersion }}）：批准 {{ formatScaledDecimal(group.approved,4) }}，
          此前 {{ formatScaledDecimal(group.prior,4) }}，本次 {{ formatScaledDecimal(group.current,4) }}
        </span>
      </div>
      <div class="settlement-work-grid-scroll">
        <BusinessDraftGrid v-if="data.length" ref="grid" data-guide-action="finance.resolution-add" grid-key="finance:settlement-work" native-headers
          :rows="rows" :columns="columns" :errors="errors"
          :row-editable="writable" :validate-batch="validateBatch" @change="updateCell" />
        <ElEmpty v-else-if="!error" description="本项目当前没有可列出的作业位置" />
      </div>
      <p class="muted">未纳入所选批准版本的行只读。允许真实超量，超出批准余量时显示差额，保存及后续审核仍按服务端业务规则办理。</p>
    </template>
  </section>
</template>
<style scoped>
.settlement-work-sheet{margin:14px 0;min-width:0}
.settlement-work-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.settlement-work-heading h3{margin:0 0 5px}
.settlement-work-heading .toolbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.settlement-work-grid-scroll{max-width:100%;overflow-x:auto}
.settlement-work-grid-scroll :deep(.business-draft-grid){min-width:0}
.settlement-work-grid-scroll :deep(.tabulator-header .tabulator-col .tabulator-col-content){
  display:block;min-height:67px;padding:7px 8px;
}
.settlement-work-grid-scroll :deep(.tabulator-col-title-holder){
  display:flex;align-items:center;min-height:20px;
}
.settlement-work-grid-scroll :deep(.tabulator-header-filter){
  display:block;width:100%;padding-top:5px;
}
.settlement-work-grid-scroll :deep(.tabulator-header-filter input){
  box-sizing:border-box;width:100%;height:25px;min-width:0;
  font-size:11px;border:1px solid var(--el-border-color);border-radius:4px;
  background:var(--content-bg);color:var(--ink);padding:3px 6px;
}
.settlement-work-grid-scroll :deep(.tabulator-col-sorter){margin-left:auto}
.settlement-work-grid-scroll :deep(.tabulator-col-title){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.settlement-unit-summary{display:flex;gap:10px;flex-wrap:wrap;padding:8px 0 12px;font-size:12px;color:var(--muted)}
.settlement-unit-summary span{padding:5px 10px;border:1px solid var(--edge);border-radius:6px}
</style>
