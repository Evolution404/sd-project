<template>
  <div class="page-container">
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
    <OperationDefinitionEditor v-model="operationOpen" :operation-id="operationId" :readonly="operationReadonly"
      :objects="objects" :units="units" @saved="crud?.refresh()" />
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
import { historyScopeField, nativeListQuery, nativeColumnFilter, activeStatusChoices } from "@/utils/business/native-list-query";
import {computed,ref,onMounted,watch} from "vue";
import { useRoute } from "vue-router";
import CrudPage from "@/components/Crud/CrudPage.vue";
import DemandSetupNavigation from "@/components/business/DemandSetupNavigation.vue";
import type {CrudSearchConfig,CrudTableConfig,CrudFormConfig,CrudRecord} from "@/components/Crud/types";
import {listDictionaries, type DictionaryRow} from "@/api/business/dictionaries";
import {listStandards,getStandard,standardDetail,saveStandard,
  type WorkKind,type WorkForm,type WorkStandardRow} from "@/api/business/standards";
import { formatBeijingDateTime } from "@/utils/business/datetime";
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
const historyOpen=ref(false),historyLoading=ref(false);
const history=ref<{versions:Array<{version?:number;version_no?:number;name:string;
  status:string;reason?:string;recorded_at?:string;changed_at?:string}>}|null>(null);
async function showHistory(id:string){
  historyOpen.value=true;historyLoading.value=true;history.value=null;
  try{history.value=await standardDetail(kind.value,id)}
  catch(e){ElMessage.error((e as Error).message)}
  finally{historyLoading.value=false}
}
const searchConfig:CrudSearchConfig={fields:[{
  type:"input",prop:"keywords",label:"搜索",attrs:{clearable:true,placeholder:"编号或名称"},
},
    historyScopeField("standards.show-deleted"),
  ]};
const tableConfig=computed<CrudTableConfig>(()=>({
  stateKey:"standards"+":"+kind.value,
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const q=query as {pageNum?:number;pageSize?:number;keywords?:string};
    const result=await listStandards(kind.value,{
      page:q.pageNum||1,size:q.pageSize||20,keyword:q.keywords||"",...nativeListQuery(query, ["status"])});
    return {list:result.items,total:result.total};
  },
  toolbarActions: kind.value === "objects"
    ? [{ key: "create", label: "新增作业对象", permission: "admin" }]
    : [{ key: "create-operation", label: "新增操作类型", permission: "admin", onClick: () => openOperation() }],
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
