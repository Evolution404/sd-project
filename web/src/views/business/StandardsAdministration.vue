<template>
  <div class="page-container">
    <div v-show="!operationOpen" class="page-container">
    <DemandSetupNavigation />
    <el-tabs v-model="kind" class="mb-4">
      <el-tab-pane name="objects" label="作业对象"/>
      <el-tab-pane name="operations" label="操作类型"/>
    </el-tabs>
    <CrudPage embedded :key="kind" ref="crud" :search-config="searchConfig" :table-config="tableConfig"
      :form-config="kind === 'objects' ? formConfig : undefined" :load-form-data="loadForm">
      <template #table-cell-version="{ row }">V{{ row.version ?? row.version_no }}</template>
      <template #table-cell-status="{row}">
        <el-tag :type="row.status==='active'?'success':'info'" effect="plain">
          {{row.status==='active'?'启用':'停用'}}
        </el-tag>
      </template>
      <template #table-cell-object_position="{row}">
        {{row.object_position==='body'?'本体':'通道'}}
      </template>
      <template #table-cell-attribution_unit="{row}">
        {{row.attribution_unit==='physical_tower'?'物理杆塔':'逻辑杆塔'}}
      </template>
    </CrudPage>
    </div>
    <OperationDefinitionEditor v-model="operationOpen" :operation-id="operationId" :readonly="operationReadonly"
      :objects="objects" :units="units" @saved="crud?.refresh()" />
    <VersionedBatchWorksheet v-if="batchOpen" ref="batchEditor" :config="batchConfig" :revise="batchRevise"
      @close="batchOpen = false" @saved="batchSaved">
      <el-form v-if="batchKind === 'operations' && !batchRevise" novalidate inline>
        <el-form-item label="作业对象">
          <el-select v-model="batchObject" filterable placeholder="选择作业对象" style="width:220px">
            <el-option v-for="option in objects.filter(row => row.status === 'active')" :key="option.id"
              :label="option.name" :value="option.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="固定计量单位">
          <el-select v-model="batchUnit" filterable placeholder="选择计量单位" style="width:200px">
            <el-option v-for="option in units.filter(row => row.status === 'active')" :key="option.id"
              :label="option.name" :value="option.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </VersionedBatchWorksheet>
    <el-drawer v-model="historyOpen" :title="title+'正式版本与采用记录'"
      size="min(90vw, 680px)" append-to-body>
      <el-skeleton v-if="historyLoading" animated :rows="6"/>
      <el-empty v-else-if="!history?.versions.length" description="暂无历史"/>
      <el-timeline v-else>
        <el-timeline-item v-for="(v,index) in history.versions" :key="index"
          :timestamp="formatBeijingDateTime(v.changed_at || v.recorded_at)" placement="top">
          <el-card shadow="never">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="版本">V{{v.version_no||v.version}}</el-descriptions-item>
              <el-descriptions-item label="名称">{{v.name}}</el-descriptions-item>
              <el-descriptions-item label="状态">{{v.status}}</el-descriptions-item>
              <el-descriptions-item label="变更说明">{{v.reason||'—'}}</el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>
  </div>
</template>
<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter, activeStatusChoices, textSearchField } from "@/utils/business/native-list-query";
import {computed,defineAsyncComponent,ref,onMounted,watch} from "vue";
import { useRoute } from "vue-router";
import CrudPage from "@/components/Crud/CrudPage.vue";
import DemandSetupNavigation from "@/components/business/DemandSetupNavigation.vue";
import type {CrudSearchConfig,CrudTableConfig,CrudFormConfig,CrudRecord} from "@/components/Crud/types";
import {listDictionaries, type DictionaryRow} from "@/api/business/dictionaries";
import {listStandards,getStandard,standardDetail,saveStandard,
  type WorkKind,type WorkForm,type WorkStandardRow} from "@/api/business/standards";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { exactScaledDecimalText, formatScaledDecimal } from "@/utils/business/fixed-scale";
import type { VersionedBatchEntryConfig } from "@/components/business/versioned-batch-entry";
import { usePageOverlays } from "@/composables/usePageOverlays";
import OperationDefinitionEditor from "@/components/business/OperationDefinitionEditor.vue";

defineOptions({name:"StandardsAdministration"});
const route = useRoute();
const kind=ref<WorkKind>("objects");
watch(() => route.query.setupTab, value => {
  if (value === "operations" || value === "objects") kind.value = value;
}, { immediate: true });
const title=computed(()=>kind.value==="objects"?"作业对象":"操作类型");
const objects = ref<WorkStandardRow[]>([]);
const units = ref<DictionaryRow[]>([]);
const crud = ref<InstanceType<typeof CrudPage>>();
const operationOpen = ref(false), operationReadonly = ref(false);
const operationId = ref<string>();
function openOperation(id?: string, readonly = false) {
  operationId.value = id;
  operationReadonly.value = readonly;
  operationOpen.value = true;
}
const VersionedBatchWorksheet = defineAsyncComponent(() => import("@/components/business/VersionedBatchWorksheet.vue"));
const batchOpen = ref(false), batchRevise = ref(false), batchKind = ref<WorkKind>("objects");
const batchEditor = ref<InstanceType<typeof VersionedBatchWorksheet>>();
const batchObject = ref(""), batchUnit = ref("");
const positions = { body: "本体", corridor: "通道" } as const;
const attribution = { physical_tower: "物理杆塔", logical_tower: "逻辑杆塔" } as const;
function openBatch(revise: boolean) {
  batchKind.value = kind.value;
  batchRevise.value = revise;
  batchObject.value = ""; batchUnit.value = "";
  batchOpen.value = true;
}
function batchSaved() {
  batchOpen.value = false;
  void crud.value?.refresh();
  void refreshReferences();
}
usePageOverlays([batchOpen], { mayLeave: () => batchOpen.value ? batchEditor.value?.mayLeave() ?? true : true });
const batchConfig = computed<VersionedBatchEntryConfig>(() => {
  const entry = batchKind.value;
  const object = entry === "objects";
  const singular = object ? "作业对象" : "操作类型";
  return {
    title: (batchRevise.value ? "批量修订" : "批量新增") + singular,
    endpoint: "/api/catalog/" + entry + "/entry-batch",
    createReady: object || Boolean(batchObject.value && batchUnit.value),
    initial: (): Record<string, string> => object ? { object_position: "本体", attribution_unit: "物理杆塔" } : { sort_order: "100" },
    columns: [
      { key: "name", title: "名称", width: 245, editable: true, required: true },
      ...(object ? [
        { key: "object_position", title: "对象位置", width: 145, editable: true, required: true, options: Object.values(positions) },
        { key: "attribution_unit", title: "归属单元", width: 165, editable: true, required: true, options: Object.values(attribution) },
      ] : [
        { key: "sort_order", title: "排序", width: 110, editable: true, numeric: true, required: true },
        { key: "default_target_object", title: "默认部位", width: 195, editable: true },
        { key: "default_quantity_scaled", title: "建议数量", width: 130, editable: true, numeric: true },
        { key: "completion_standard", title: "验收标准", width: 235, editable: true },
        { key: "entry_hint", title: "录入提示", width: 235, editable: true },
      ]),
      { key: "reason", title: "修订说明", width: 230, editable: true },
    ],
    async choices(keyword, page) {
      const result = await listStandards(entry, { keyword, page, size: 20 });
      return { total: result.total, items: result.items.map(row => ({
        id: row.id, code: row.code, name: row.name, version: row.version_no ?? row.version ?? 1,
        context: row.work_object_id_label,
        fields: {
          name: row.name, reason: "",
          ...(object ? {
            object_position: positions[row.object_position as keyof typeof positions],
            attribution_unit: attribution[row.attribution_unit as keyof typeof attribution],
          } : {
            sort_order: String(row.sort_order ?? 100), default_target_object: row.default_target_object || "",
            default_quantity_scaled: row.default_quantity_scaled == null ? "" : formatScaledDecimal(row.default_quantity_scaled, 4),
            completion_standard: row.completion_standard || "", entry_hint: row.entry_hint || "",
          }),
        },
      })) };
    },
    values(fields, record) {
      const common = { name: fields.name.trim(), reason: fields.reason || "" };
      if (object) return { ...common,
        object_position: fields.object_position === "本体" ? "body" : "corridor",
        attribution_unit: fields.attribution_unit === "物理杆塔" ? "physical_tower" : "logical_tower" };
      const order = Number(fields.sort_order);
      if (!/^[0-9]+$/.test(fields.sort_order) || !Number.isSafeInteger(order))
        throw Object.assign(Error("排序须为非负整数"), { field: "sort_order" });
      const quantity = fields.default_quantity_scaled?.trim();
      const scaled = quantity ? exactScaledDecimalText(quantity, 4) : null;
      if (quantity && (scaled === null || scaled <= 0))
        throw Object.assign(Error("建议数量须为正数，最多四位小数"), { field: "default_quantity_scaled" });
      return { ...common, sort_order: order, default_target_object: fields.default_target_object || "",
        default_quantity_scaled: scaled, completion_standard: fields.completion_standard || null, entry_hint: fields.entry_hint || "",
        ...(record ? {} : { work_object_id: batchObject.value, default_unit_id: batchUnit.value }) };
    },
  };
});
const historyOpen=ref(false),historyLoading=ref(false);
const history=ref<{versions:Array<{version?:number;version_no?:number;name:string;
  status:string;reason?:string;recorded_at?:string;changed_at?:string}>}|null>(null);
async function showHistory(id:string){
  historyOpen.value=true;historyLoading.value=true;history.value=null;
  try{history.value=await standardDetail(kind.value,id)}
  catch(e){ElMessage.error((e as Error).message)}
  finally{historyLoading.value=false}
}
const searchConfig = computed<CrudSearchConfig>(() => ({fields:[{
  type:"input",prop:"keywords",label:"搜索",attrs:{clearable:true,placeholder:"编号或名称"},
},
    historyScopeField("standards.show-deleted"),
    ...(kind.value === "objects" ? [
      { type: "select" as const, prop: "object_position", label: "对象位置", attrs: { clearable: true },
        options: [{ label: "本体", value: "body" }, { label: "通道", value: "corridor" }] },
      { type: "select" as const, prop: "attribution_unit", label: "归属单元", attrs: { clearable: true },
        options: [{ label: "物理杆塔", value: "physical_tower" }, { label: "逻辑杆塔", value: "logical_tower" }] },
    ] : [
      textSearchField("work_object_id_label", "采用作业对象"),
      textSearchField("default_unit_id_label", "计量单位"),
    ]),
  ]}));
const tableConfig=computed<CrudTableConfig>(()=>({
  stateKey:"standards"+":"+kind.value,
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const q=query as {pageNum?:number;pageSize?:number;keywords?:string};
    const result=await listStandards(kind.value,{
      page:q.pageNum||1,size:q.pageSize||20,keyword:q.keywords||"",...nativeListQuery(query, ["status"], false,
        ["object_position", "attribution_unit", "work_object_id_label", "default_unit_id_label"])});
    return {list:result.items,total:result.total};
  },
  toolbarActions: [
    kind.value === "objects"
      ? { key: "create", label: "新增作业对象", permission: "admin" }
      : { key: "create-operation", label: "新增操作类型", permission: "admin", onClick: () => openOperation() },
    { key: "batch-create", label: "批量新增", permission: "admin", onClick: () => openBatch(false) },
    { key: "batch-revise", label: "批量修订", permission: "admin", onClick: () => openBatch(true) },
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"code",sortable:"custom",label:"编码",minWidth:145,fixed:"left"},
    {prop:"name",sortable:"custom",label:title.value,minWidth:190},
    ...(kind.value==="objects"?[
      {prop:"object_position",sortable:"custom",label:"对象位置",cellType:"custom" as const,minWidth:130},
      {prop:"attribution_unit",sortable:"custom",label:"归属单元",cellType:"custom" as const,minWidth:160},
    ]:[
      {prop:"work_object_id_label",sortable:"custom",label:"采用作业对象",minWidth:190},
      {prop:"default_unit_id_label",sortable:"custom",label:"计量单位",minWidth:150},
      {prop:"completion_standard",sortable:"custom",label:"验收标准",minWidth:180},
    ]),
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",activeStatusChoices),label:"状态",cellType:"custom",width:100},
    {prop:"version",label:"版本",cellType:"custom",width:96},
    {prop:"actions",label:"操作",cellType:"actions",width:230,fixed:"right",
      actions: kind.value === "objects" ? [
        {key:"view",label:"查看",permission:"read"},
        {key:"edit",label:"修订",permission:"admin"},
        {key:"history",label:"历史",permission:"read",onClick:({row})=>row&&showHistory(String(row.id))},
      ] : [
        {key:"view-operation",label:"查看",permission:"read",
          onClick:({row})=>row&&openOperation(String(row.id),true)},
        {key:"edit-operation",label:"修订",permission:"admin",
          onClick:({row})=>row&&openOperation(String(row.id))},
      ]},
  ],
}));
const formConfig: CrudFormConfig<WorkForm> = {
  title:({mode})=>({create:"新增",edit:"修订",view:"查看"})[mode]+title.value,
  rowKey:"id",dialog:{width:720},
  fields:[
    {type:"input-number",prop:"version_no",
      label:"正式版本",hidden:true},
    {type:"input",prop:"code",label:"系统编码",readonly:true,
      visible:({mode})=>mode!=="create"},
    {type:"input",prop:"name",label:"名称",required:true},
    {type:"radio",prop:"status",label:"状态",initialValue:"active",options:[
      {label:"启用",value:"active"},{label:"停用",value:"inactive"}]},
    {type:"select",prop:"object_position",label:"对象位置",required:true,options:[
      {label:"本体",value:"body"},{label:"通道",value:"corridor"}]},
    {type:"select",prop:"attribution_unit",label:"归属单元",required:true,options:[
      {label:"物理杆塔",value:"physical_tower"},{label:"逻辑杆塔",value:"logical_tower"}]},
    {type:"input",prop:"reason",label:"修订说明"},
  ],
  async submitForm(data,{mode,id}){
    if(mode==="view")return;
    await saveStandard("objects",data,id===undefined?undefined:String(id));
  },
};
async function loadForm(row:CrudRecord):Promise<CrudRecord> {
  return { ...await getStandard("objects",String(row.id),Boolean(row.deleted)) };
}
async function refreshReferences(){
  try{
    const [available,unitList]=await Promise.all([
      listStandards("objects",{size:500}),listDictionaries("units",{size:500}),
    ]);
    objects.value=available.items.filter(x=>x.status==="active");
    units.value=unitList.items.filter(x=>x.status==="active");
  }catch(e){ElMessage.error((e as Error).message)}
}
onMounted(refreshReferences);
watch(kind,()=>{if(kind.value==="operations")void refreshReferences()});
</script>
