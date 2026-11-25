<template>
  <div class="page-container">
    <DemandSetupNavigation />
    <el-tabs v-show="!bulkMode" v-model="kind" class="mb-4">
      <el-tab-pane v-for="tab in tabs" :key="tab.key" :name="tab.key" :label="tab.label"/>
    </el-tabs>
    <CrudPage v-show="!bulkMode" embedded :key="kind" ref="crud"
      :search-config="searchConfig" :table-config="tableConfig"
      :form-config="formConfig" :load-form-data="loadForm">
      <template #table-cell-line_kind="{row}">{{equipmentLineKind(row.line_kind)}}</template>
      <template #table-cell-status="{row}">
        <el-tag :type="row.status==='active'?'success':'info'" effect="plain">
          {{equipmentStatus(row.status)}}
        </el-tag>
      </template>
      <template #[`table-cell-${identityProp}`]="{row}">
        <el-link type="primary" :underline="false" @click="showDetail(String(row.id))">
          {{row[identityProp] || "—"}}
        </el-link>
      </template>
      <template #table-cell-transmission_center_length_mm="{row}">
        {{spanLength(row.transmission_center_length_mm)}}
      </template>
      <template v-for="field in referenceFields" #[`form-${field.prop}`]="{formData,mode}">
        <EquipmentReferenceField :kind="field.kind" :title="field.label" :model-value="formData[field.prop] as string|null"
          :main-only="field.prop==='parent_line_id'" :clearable="!field.required"
          :line-id="field.prop==='junction_tower_id'?String(formData.parent_line_id||''):field.kind==='towers'?String(formData.line_id||''):undefined"
          :disabled="mode==='view'||(field.kind==='towers' && !(field.prop==='junction_tower_id'?formData.parent_line_id:formData.line_id))"
          @update:model-value="value=>setReference(formData as EquipmentForm,field.prop,value)"/>
      </template>
    </CrudPage>
    <EquipmentBulkEditor v-if="bulkMode && bulkKind" :kind="bulkKind" :records="bulkRecords" :options="options"
      @cancel="endBulk(false)" @saved="endBulk(true)"/>
    <CatalogCreateWorksheet v-if="createBatchOpen && createBatchKind" ref="createBatchEditor"
      :kind="createBatchKind" :options="options" @close="createBatchOpen = false" @saved="createdBatch" />
    <BusinessExchangeDialog v-if="exchangeOpen" kind="assets" :asset-kind="exchangeKind"
      :applied-query="equipmentQuery" @close="exchangeOpen = false" @changed="refreshAssets" />
    <el-drawer v-model="detailVisible" :title="title+'设备关系与正式历史'"
      size="min(95vw, 900px)" append-to-body>
      <el-skeleton v-if="detailLoading" animated :rows="7"/>
      <template v-else-if="detail">
        <el-descriptions border :column="2">
          <el-descriptions-item v-if="kind==='lines'" label="线路编号">{{detail.line_code}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='lines'" label="线路性质">{{equipmentLineKind(detail.line_kind)}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='lines'||kind==='voltages'" label="名称">{{detail.name}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='physical'" label="物理杆塔编号">{{detail.tower_code}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='physical'" label="现场铭牌">{{detail.asset_no||'—'}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='towers'" label="杆塔号">{{detail.tower_no}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='spans'" label="起点杆塔号">{{detail.start_tower_no}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='spans'" label="终点杆塔号">{{detail.end_tower_no}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='spans'" label="输电中心管辖长度（米）">{{spanLength(detail.transmission_center_length_mm)}}</el-descriptions-item>
          <el-descriptions-item v-if="detail.voltage_level_name" label="电压等级">{{detail.voltage_level_name}}</el-descriptions-item>
          <el-descriptions-item label="正式版本">V{{detail.version}}</el-descriptions-item>
          <el-descriptions-item label="当前状态">{{equipmentStatus(detail.status)}}</el-descriptions-item>
          <el-descriptions-item v-if="kind==='towers'||kind==='spans'" label="所属线路">{{detail.line_id_label||'—'}}</el-descriptions-item>
          <el-descriptions-item label="同塔回路数">{{detail.current_circuits??'—'}}</el-descriptions-item>
          <el-descriptions-item label="归属物理杆塔">{{detail.physical_tower_id_label||'—'}}</el-descriptions-item>
        </el-descriptions>
        <template v-if="detail.bindings?.length">
          <el-divider>关联回路</el-divider>
          <el-table :data="detail.bindings" row-key="logical_tower_id" border>
            <el-table-column prop="line_name" label="线路名称" min-width="160"/>
            <el-table-column prop="voltage_name" label="电压等级" min-width="100"/>
            <el-table-column prop="tower_no" label="杆塔号" min-width="100"/>
            <el-table-column label="状态" min-width="100"><template #default="{row}">{{equipmentStatus(row.logical_status)}}</template></el-table-column>
          </el-table>
        </template>
        <template v-if="replacementHistory.length">
          <el-divider>整基更换记录</el-divider>
          <el-table :data="replacementHistory" row-key="id" border>
            <el-table-column prop="at" label="更换登记时间" min-width="175" />
            <el-table-column label="原物理杆塔" min-width="135">
              <template #default="{ row }">
                <el-button v-if="row.previous !== detail.id" link type="primary" @click="showDetail(row.previous)">查看原杆塔</el-button>
                <span v-else>当前查看</span>
              </template>
            </el-table-column>
            <el-table-column label="接续物理杆塔" min-width="135">
              <template #default="{ row }">
                <el-button v-if="row.next !== detail.id" link type="primary" @click="showDetail(row.next)">查看接续杆塔</el-button>
                <span v-else>当前查看</span>
              </template>
            </el-table-column>
            <el-table-column prop="circuits" label="接续回路数" min-width="220" />
          </el-table>
        </template>
        <el-divider>正式历史</el-divider>
        <el-button v-if="!historyOpen" data-guide-action="ledger.history" @click="historyOpen = true">读取正式历史</el-button>
        <div v-else class="mt-4"><BusinessHistoryViewer :target="{ kind, id: detail.id }" /></div>
        <el-button v-if="kind === 'physical' && detail.status !== 'retired' && !detail.deleted"
          v-hasPerm="'admin'" class="mt-4" type="primary" data-guide-action="ledger.replace" @click="replacementOpen = true">
          整基更换
        </el-button>
      </template>
    </el-drawer>
    <PhysicalTowerReplacement v-model="replacementOpen" :physical-id="detail?.id ?? ''"
      :materials="options.tower_material ?? []" :natures="options.tower_nature ?? []" @replaced="onReplaced" />
  </div>
</template>
<script setup lang="ts">
import {equipmentLineKind,equipmentStatus,EQUIPMENT_LINE_KINDS} from "../../../../server/shared/equipment-bulk";
import { historyScopeField, nativeListQuery, nativeColumnFilter, applyNativeListQuery } from "@/utils/business/native-list-query";
import {computed,defineAsyncComponent,nextTick,onMounted,ref} from "vue";
import {usePageOverlays} from "@/composables/usePageOverlays";
import EquipmentBulkEditor from "./EquipmentBulkEditor.vue";
import EquipmentReferenceField from "@/components/business/EquipmentReferenceField.vue";
import {isEquipmentBulkKind,MAX_EQUIPMENT_WORKSHEET_ROWS,type EquipmentBulkKind} from "../../../../server/shared/equipment-bulk";
import CrudPage from "@/components/Crud/CrudPage.vue";
import PhysicalTowerReplacement from "@/components/business/PhysicalTowerReplacement.vue";
import DemandSetupNavigation from "@/components/business/DemandSetupNavigation.vue";
import BusinessExchangeDialog from "@/components/business/BusinessExchangeDialog.vue";
import BusinessHistoryViewer from "@/components/business/BusinessHistoryViewer.vue";
import type {CrudSearchConfig,CrudTableConfig,CrudFormConfig,CrudRecord} from "@/components/Crud/types";
import type {OptionItem} from "@/api/common";
import {listDictionaries} from "@/api/business/dictionaries";
import {
  listEquipment,getEquipment,saveEquipment,equipmentForm,
  type EquipmentKind,type EquipmentForm,type EquipmentRow,
} from "@/api/business/equipment";
import {formatScaledDecimal} from "@/utils/business/fixed-scale";
import { formatBeijingDateTime } from "@/utils/business/datetime";

defineOptions({name:"EquipmentAdministration"});
const tabs=[{key:"lines",label:"输电线路"},{key:"physical",label:"物理杆塔"},
  {key:"towers",label:"逻辑杆塔"},{key:"spans",label:"档距"},
  {key:"voltages",label:"电压等级"}] as const;
const kind=ref<EquipmentKind>("lines");
const title=computed(()=>tabs.find(x=>x.key===kind.value)?.label||"设备台账");
const identityProp=computed(() => kind.value==="physical"?"tower_code":kind.value==="towers"?"tower_no":kind.value==="spans"?"start_tower_no":"name");
function spanLength(millimetres?: number | null) {
  return millimetres == null ? "未知" : formatScaledDecimal(millimetres, 3) + " 米";
}
const options=ref<Record<string,OptionItem[]>>({});
const crud=ref<InstanceType<typeof CrudPage>>();
const replacementOpen=ref(false);
const detailVisible=ref(false),detailLoading=ref(false),detail=ref<EquipmentRow|null>(null);
const historyOpen = ref(false), exchangeOpen = ref(false), equipmentQuery = ref("");
const exchangeKind = computed(() => kind.value === "voltages" ? undefined : kind.value);
const replacementHistory = computed(() => (detail.value?.replacements ?? []).flatMap(event => {
  if (!event.after_json) return [];
  const decision = JSON.parse(event.after_json) as {
    old_physical_id: string; new_physical_id: string; bindings: Array<{ logical_tower_id:string; line_name?:string; tower_no?:string }>;
  };
  return [{ id: event.id, at: formatBeijingDateTime(event.created_at),
    previous: decision.old_physical_id, next: decision.new_physical_id,
    circuits: decision.bindings.length }];
}));
async function showDetail(id:string,includeDeleted=false){
  detailVisible.value=true;detailLoading.value=true;detail.value=null;
  historyOpen.value = false;
  try{detail.value=await getEquipment(kind.value,id,includeDeleted)}
  catch(e){ElMessage.error((e as Error).message)}
  finally{detailLoading.value=false}
}
async function refreshAssets() { await Promise.all([crud.value?.refresh(), refreshReferences()]); }
async function onReplaced(tower: EquipmentRow) {
  await showDetail(tower.id);
  await Promise.all([crud.value?.refresh(), refreshReferences()]);
}
const CatalogCreateWorksheet = defineAsyncComponent(() => import("@/components/business/CatalogCreateWorksheet.vue"));
const createBatchOpen = ref(false), createBatchKind = ref<EquipmentBulkKind>();
const createBatchEditor = ref<InstanceType<typeof CatalogCreateWorksheet>>();
function startCreateBatch() {
  if (!isEquipmentBulkKind(kind.value)) return;
  createBatchKind.value = kind.value;
  createBatchOpen.value = true;
}
async function createdBatch() {
  createBatchOpen.value = false;
  await refreshAssets();
}
usePageOverlays([createBatchOpen], { mayLeave: () => createBatchOpen.value ? createBatchEditor.value?.mayLeave() ?? true : true });
const bulkMode=ref(false),bulkKind=ref<EquipmentBulkKind>(),bulkRecords=ref<EquipmentRow[]>([]);
const loadedPage=ref<EquipmentRow[]>([]);
const editableEquipment=(row:CrudRecord)=>!row.deleted&&row.status!=="retired";
function startBulk({selectedRows}:{selectedRows:readonly CrudRecord[]}){
  if(!isEquipmentBulkKind(kind.value))return;
  const source=selectedRows.length?selectedRows as readonly EquipmentRow[]:loadedPage.value;
  const selected=source.filter(editableEquipment);
  if(!selected.length){ElMessage.warning("请选择可维护的设备");return}
  if(selected.length>MAX_EQUIPMENT_WORKSHEET_ROWS){ElMessage.warning("单次批量编辑最多"+MAX_EQUIPMENT_WORKSHEET_ROWS+"条");return}
  bulkKind.value=kind.value;bulkRecords.value=selected.map(row=>({...row}));bulkMode.value=true;
}
async function endBulk(saved:boolean){bulkMode.value=false;await nextTick();if(saved)await refreshAssets()}
let equipmentListSequence=0;
const searchConfig = computed<CrudSearchConfig>(() => ({ fields: [{
  type:"input",prop:"keywords",label:"设备检索",attrs:{clearable:true,
    placeholder:"线路名称、杆塔号或现场铭牌"},
},
    ...(kind.value === "spans" ? [{ type: "input" as const, prop: "lengthMetres",
      label: "输电中心管辖长度（米）", attrs: { clearable: true, inputmode: "decimal" } }] : []),
    historyScopeField("ledger.show-deleted"),
  ] }));
const tableConfig=computed<CrudTableConfig>(()=>({
  stateKey:"equipment"+":"+kind.value,
  table:{border:true},rowKey:"id",
  fetchData:async query=>{
    const sequence=++equipmentListSequence;
    const q=query as {pageNum?:number;pageSize?:number;keywords?:string;lengthMetres?:string};
    const list = nativeListQuery(query, ["status", "line_kind"], true);
    if (kind.value === "spans" && q.lengthMetres?.trim()) {
      (list.filters ??= {}).transmission_center_length_mm = q.lengthMetres.trim();
    }
    const result=await listEquipment(kind.value,{
      page:q.pageNum||1,size:q.pageSize||20,keyword:q.keywords||"",...list});
    if (sequence === equipmentListSequence) {
      loadedPage.value = result.items;
      equipmentQuery.value = applyNativeListQuery(new URLSearchParams({ q: q.keywords || "" }), list).toString();
    }
    return {list:result.items,total:result.total};
  },
  toolbarActions:[
    {key:"create",label:"新增"+title.value,permission:"admin"},
    {key:"bulk-create",label:"批量新增",permission:"admin",visible:()=>isEquipmentBulkKind(kind.value),onClick:startCreateBatch},
    {key:"bulk",label:"进入批量编辑",permission:"admin",visible:()=>isEquipmentBulkKind(kind.value),
      disabled:({selectedRows})=>!selectedRows.some(editableEquipment)&&!loadedPage.value.some(editableEquipment),onClick:startBulk},
    {key:"exchange",label:"导入 Excel",permission:"admin",visible:()=>Boolean(exchangeKind.value),
      onClick:()=>{ exchangeOpen.value = true; }},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    ...(isEquipmentBulkKind(kind.value)?[{type:"selection" as const,width:48,reserveSelection:true,selectable:editableEquipment,hideable:false}]:[]),
    {prop:identityProp.value,sortable:kind.value==="spans"?false:"custom",label:kind.value==="physical"?"物理杆塔编号":kind.value==="towers"?"杆塔号":kind.value==="spans"?"起点杆塔号":kind.value==="lines"?"线路名称":"电压名称",cellType:"custom",minWidth:160,fixed:"left"},
    ...(kind.value==="physical"?[
      {prop:"asset_no",sortable:"custom",label:"现场铭牌",minWidth:130},
      {prop:"tower_material_label",label:"杆塔材质",minWidth:145},
      {prop:"tower_nature_label",label:"杆塔性质",minWidth:125},
      {prop:"current_circuits",sortable:"custom",label:"同塔回路",width:110},
    ]:kind.value==="lines"?[
      {prop:"voltage_level_name",sortable:"custom",label:"电压等级",minWidth:130},
      {prop:"line_kind",sortable:"custom",label:"线路性质",cellType:"custom" as const,width:110,...nativeColumnFilter("line_kind",Object.entries(EQUIPMENT_LINE_KINDS).map(([value,text])=>({text,value})),true)},
    ]:kind.value==="towers"?[
      {prop:"line_id_label",label:"所属线路",minWidth:220},
      {prop:"logical_code",label:"逻辑杆塔编号",minWidth:140},
      {prop:"physical_tower_id_label",label:"物理杆塔编号",minWidth:145},
    ]:kind.value==="spans"?[
      {prop:"line_id_label",label:"所属线路",minWidth:210},
      {prop:"end_tower_no",label:"终点杆塔号",minWidth:115},
      {prop:"transmission_center_length_mm",sortable:"custom",label:"输电中心管辖长度（米）",
        cellType:"custom" as const,minWidth:175},
    ]:[]),
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",[{text:"在运",value:"active"},{text:"退役",value:"retired"},{text:"草稿",value:"draft"},{text:"停用",value:"inactive"}],true),label:"状态",cellType:"custom",width:100},
    {prop:"version",sortable:"custom",label:"正式版本",width:100},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:240,actions:[
      {key:"detail",label:"设备关系",permission:"read",
        onClick:({row})=>row&&showDetail(String(row.id),Boolean(row.deleted))},
      {key:"edit",label:"维护资料",permission:"admin"},
    ]},
  ],
}));
const referenceFields=[
  {prop:"line_id",kind:"lines",label:"所属线路",required:true},
  {prop:"parent_line_id",kind:"lines",label:"所属主线",required:false},
  {prop:"junction_tower_id",kind:"towers",label:"分支接入塔",required:false},
  {prop:"physical_tower_id",kind:"physical",label:"关联物理杆塔",required:false},
  {prop:"start_tower_id",kind:"towers",label:"起点逻辑杆塔",required:true},
  {prop:"end_tower_id",kind:"towers",label:"终点逻辑杆塔",required:true},
] as const;
function setReference(form:EquipmentForm,prop:typeof referenceFields[number]["prop"],value:string|null){
  const record=form as Record<string,unknown>;
  if(record[prop]===value)return;
  record[prop]=value;
  if(prop==="line_id"){record.start_tower_id=null;record.end_tower_id=null;}
  if(prop==="parent_line_id")record.junction_tower_id=null;
}
const reference=(prop:string,label:string,required=false)=>({type:"custom" as const,prop,label,required});
const pick=(prop:string,label:string,required=false)=>({
  type:"select" as const,prop,label,required,
  options:computed(()=>options.value[prop]||[]),
  attrs:{filterable:true,clearable:!required},
});
const formConfig=computed<CrudFormConfig<EquipmentForm>>(()=>({
  title:({mode})=>({create:"新增",edit:"维护",view:"查看"})[mode]+title.value,
  dialog:{width:760},rowKey:"id",
  fields:[
    {type:"input-number",prop:"version",label:"正式版本",hidden:true},
    ...(kind.value==="lines"?[
      {type:"input" as const,prop:"name",label:"线路名称",required:true},
      pick("voltage_level_id","电压等级",true),
      {type:"select" as const,prop:"line_kind",label:"线路性质",
        initialValue:"main",options:Object.entries(EQUIPMENT_LINE_KINDS).map(([value,label])=>({label,value}))},
      reference("parent_line_id","所属主线"),
      reference("junction_tower_id","分支接入塔"),
    ]:kind.value==="physical"?[
      {type:"input" as const,prop:"asset_no",label:"已有现场铭牌"},
      pick("tower_material","杆塔材质"),pick("tower_nature","杆塔性质"),
      {type:"input" as const,prop:"model",label:"型号"},
      {type:"input" as const,prop:"height_text",label:"杆塔高度（米）"},
      {type:"input" as const,prop:"purpose",label:"用途"},
      {type:"date-picker" as const,prop:"commissioned_on",label:"投运日期",
        attrs:{valueFormat:"YYYY-MM-DD"}},
      {type:"input-number" as const,prop:"longitude",label:"经度",attrs:{min:-180,max:180,precision:6}},
      {type:"input-number" as const,prop:"latitude",label:"纬度",attrs:{min:-90,max:90,precision:6}},
    ]:kind.value==="towers"?[
      reference("line_id","所属线路",true),
      {type:"input" as const,prop:"tower_no",label:"杆塔号",required:true},
      reference("physical_tower_id","关联物理杆塔"),
      {type:"input-number" as const,prop:"sort_rank",label:"线路排序",
        attrs:{min:1,precision:0}},
      {type:"input" as const,prop:"display_name",label:"显示名称"},
      {type:"input" as const,prop:"operations_team",label:"运维班组"},
      {type:"input" as const,prop:"management_department",label:"管辖部门"},
    ]:kind.value==="spans"?[
      reference("line_id","所属线路",true),
      reference("start_tower_id","起点逻辑杆塔",true),
      reference("end_tower_id","终点逻辑杆塔",true),
      {type:"input" as const,prop:"length_text",label:"输电中心管辖长度（米）",
        tips:"只统计中心管辖长度；空白表示未知，不代表0米"},
    ]:[
      {type:"input" as const,prop:"name",label:"电压名称",required:true},
    ]),
    {type:"select",prop:"status",label:"状态",initialValue:"active",options:[
      {label:"在运",value:"active"},{label:"停用",value:"inactive"},
      ...(kind.value==="voltages"?[]:[{label:"退役",value:"retired"}]),...(kind.value==="towers"||kind.value==="spans"?
        [{label:"草稿",value:"draft"}]:[])],
    },
    {type:"input",prop:"change_reason",label:"维护原因"},
  ],
  async submitForm(form,{mode,id}){
    if(mode==="view")return;
    await saveEquipment(kind.value,form,id===undefined?undefined:String(id));
    if (kind.value === "voltages") await refreshReferences();
  },
}));
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  return equipmentForm(await getEquipment(kind.value,String(row.id)));
}
async function refreshReferences(){
  try {
    const [voltages,materials,natures]=await Promise.all([
      listEquipment("voltages",{size:500}),
      listDictionaries("tower_materials",{size:500}),
      listDictionaries("tower_natures",{size:500}),
    ]);
    options.value={
      voltage_level_id:voltages.items.filter(x=>x.status==="active")
        .map(x=>({label:x.name||x.label,value:x.id})),
      tower_material:materials.items.filter(x=>x.status==="active")
        .map(x=>({label:x.name,value:x.id})),
      tower_nature:natures.items.filter(x=>x.status==="active")
        .map(x=>({label:x.name,value:x.id})),
    };
  }catch(e){ElMessage.error((e as Error).message)}
}
onMounted(refreshReferences);
</script>
