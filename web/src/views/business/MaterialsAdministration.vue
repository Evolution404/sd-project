<template>
  <CrudPage
    v-show="!bulkMode"
    ref="crud"
    :search-config="searchConfig"
    :table-config="tableConfig"
    :form-config="formConfig"
    :load-form-data="loadForm"
  >
    <template #table-cell-status="{ row }">
      <el-tag :type="row.status === 'active' ? 'success' : 'warning'" effect="plain">
        {{ row.status === "active" ? "启用" : "停用" }}
      </el-tag>
    </template>
  </CrudPage>
  <MaterialBulkEditor v-if="bulkMode" :records="bulkRecords" :page="bulkPage" :total="bulkTotal" @cancel="endBulkEdit(false)" @saved="endBulkEdit(true)" />
  <CatalogCreateWorksheet v-if="createBatchOpen" ref="createBatchEditor" kind="materials"
    :options="{unit_id:unitOptions}" @close="createBatchOpen = false" @saved="createdBatch" />
  <el-drawer v-model="historyVisible" title="物资正式版本历史" size="640px" append-to-body>
    <el-skeleton v-if="historyLoading" :rows="6" animated />
    <template v-else>
      <el-descriptions v-if="history" :column="2" border>
        <el-descriptions-item label="物资编码">{{ history.item.code }}</el-descriptions-item>
        <el-descriptions-item label="当前版本">V{{ history.item.version_no }}</el-descriptions-item>
        <el-descriptions-item label="物资名称">{{ history.item.name }}</el-descriptions-item>
        <el-descriptions-item label="计量单位">{{ history.item.unit_id_label }}</el-descriptions-item>
      </el-descriptions>
      <el-timeline class="mt-4">
        <el-timeline-item v-for="version in history?.versions || []" :key="version.id"
          :timestamp="formatBeijingDateTime(version.recorded_at)" type="primary" placement="top">
          <el-card shadow="never">
            <strong>V{{ version.version_no }}</strong><p>物资名称：{{ version.name }}</p>
            <p>型号：{{ version.model || "—" }}</p><p>规格：{{ version.specification || "—" }}</p>
            <p>备注：{{ version.note || "—" }}</p>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { textSearchField, historyScopeField, nativeListQuery, nativeColumnFilter, activeStatusChoices } from "@/utils/business/native-list-query";
import {defineAsyncComponent,nextTick,onMounted,ref} from "vue";
import {usePageOverlays} from "@/composables/usePageOverlays";
import {MAX_MATERIAL_WORKSHEET_ROWS} from "../../../../server/shared/types/master-data";
import CrudPage from "@/components/Crud/CrudPage.vue";
import MaterialBulkEditor from "./MaterialBulkEditor.vue";
import type {CrudRecord,CrudSearchConfig,CrudTableConfig,CrudFormConfig} from "@/components/Crud/types";
import type {OptionItem} from "@/api/common";
import {formatBeijingDateTime} from "@/utils/business/datetime";
import {
  queryMaterials,readMaterial,saveMaterial,deleteMaterial,listUnitOptions,materialHistory,
  type Material,type MaterialForm,
} from "@/api/business/materials";
defineOptions({name:"MaterialsAdministration"});

const crud=ref<InstanceType<typeof CrudPage>>();
const unitOptions=ref<OptionItem[]>([]);
const CatalogCreateWorksheet = defineAsyncComponent(() => import("@/components/business/CatalogCreateWorksheet.vue"));
const createBatchOpen = ref(false);
const createBatchEditor = ref<InstanceType<typeof CatalogCreateWorksheet>>();
async function createdBatch() {
  createBatchOpen.value = false;
  await crud.value?.refresh();
}
usePageOverlays([createBatchOpen], { mayLeave: () => createBatchOpen.value ? createBatchEditor.value?.mayLeave() ?? true : true });
const bulkMode=ref(false);
const bulkRecords=ref<Material[]>([]);
const bulkPage=ref(1),bulkTotal=ref(0);
let listSequence=0;
const loadedPage=ref<{rows:Material[];page:number;total:number}|null>(null);
function startBulkEdit({selectedRows}: {selectedRows:readonly CrudRecord[]}) {
  const loaded=loadedPage.value;
  if(!loaded?.rows.length){ElMessage.warning("请先查询需要批量编辑的物资");return}
  const source=selectedRows.length ? selectedRows as readonly Material[] : loaded.rows;
  const selected=source.filter(row=>!row.deleted);
  if(selected.length>MAX_MATERIAL_WORKSHEET_ROWS){ElMessage.warning("单次批量编辑最多"+MAX_MATERIAL_WORKSHEET_ROWS+"条，请缩小范围");return}
  bulkRecords.value=selected.map(row=>({...row}));
  if(!bulkRecords.value.length){ElMessage.warning("当前页只有已删除记录，不能编辑");return}
  bulkPage.value=loaded.page;bulkTotal.value=loaded.total;bulkMode.value=true;
}
async function endBulkEdit(saved:boolean){
  bulkMode.value=false;
  await nextTick();
  if(saved)await crud.value?.refresh();
}
const historyVisible=ref(false),historyLoading=ref(false);
const history=ref<Awaited<ReturnType<typeof materialHistory>>|null>(null);
async function openHistory(id:string){
  historyVisible.value=true;historyLoading.value=true;history.value=null;
  try{history.value=await materialHistory(id)}
  catch(e){ElMessage.error((e as Error).message)}
  finally{historyLoading.value=false}
}
const searchConfig:CrudSearchConfig={
  fields:[
    {type:"input",prop:"keywords",label:"搜索物资",attrs:{
      placeholder:"编码 / 名称 / 型号 / 规格",clearable:true,
    }},
    {type:"select",prop:"status",label:"状态",attrs:{clearable:true},
      options:[{label:"有效",value:"active"},{label:"停用",value:"inactive"}]},
    historyScopeField("materials.show-deleted"),
    textSearchField("model", "型号"),
    textSearchField("specification", "规格"),
    textSearchField("unit_id_label", "计量单位"),
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"materials",
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const sequence=++listSequence;loadedPage.value=null;
    const params=query as {pageNum?:number;pageSize?:number;keywords?:string;status?:string};
    const data=await queryMaterials({
      page:params.pageNum||1,pageSize:params.pageSize||20,
      keyword:params.keywords||"",status:params.status,...nativeListQuery(query, ["status"], false, ["model", "specification", "unit_id_label"]),
    });
    if(sequence===listSequence)loadedPage.value={rows:data.items,page:params.pageNum||1,total:data.total};
    return {list:data.items,total:data.total};
  },
  toolbarActions:[
    {key:"create",label:"新增物资",permission:"admin"},
    {key:"bulk-create",label:"批量新增物资",permission:"admin",onClick:()=>{createBatchOpen.value=true}},
    {key:"bulk",label:"进入批量编辑",permission:"admin",disabled:({selectedRows})=>!selectedRows.some(row=>!row.deleted)&&!loadedPage.value?.rows.some(row=>!row.deleted),onClick:startBulkEdit},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {type:"selection",width:48,reserveSelection:true,selectable:(row:CrudRecord)=>!row.deleted,hideable:false},
    {prop:"code",sortable:"custom",label:"物资编码",minWidth:140,fixed:"left"},
    {prop:"name",sortable:"custom",label:"物资名称",minWidth:180},
    {prop:"model",sortable:"custom",label:"型号",minWidth:145},
    {prop:"specification",sortable:"custom",label:"规格",minWidth:150},
    {prop:"unit_id_label",sortable:"custom",label:"计量单位",minWidth:125},
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",activeStatusChoices),label:"状态",cellType:"custom",width:98},
    {prop:"note",sortable:"custom",label:"备注",minWidth:160},
    {prop:"version_no",sortable:"custom",label:"正式版本",width:105},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:245,
      actions:[
        {key:"view",label:"查看",permission:"read"},
        {key:"edit",label:"编辑",permission:"admin"},
        {key:"delete",label:"停用/删除",permission:"admin"},
        {key:"history",label:"版本历史",permission:"read",
          onClick:({row})=>row && openHistory(String(row.id))},
      ],
    },
  ],
  deleteByIds:async ids=>{
    for(const id of ids.split(",")){
      const current=await readMaterial(id);
      await deleteMaterial(id,current.version_no);
    }
  },
};
const formConfig:CrudFormConfig<MaterialForm>={
  title:({mode})=>({create:"新增物资",edit:"修订物资",view:"物资详情"})[mode],
  rowKey:"id",dialog:{width:650},
  fields:[
    {type:"input",prop:"code",label:"物资编码",visible:({mode})=>mode!=="create",readonly:true},
    {type:"input-number",prop:"version_no",label:"正式版本号",hidden:true},
    {type:"input",prop:"name",label:"物资名称",required:true},
    {type:"select",prop:"unit_id",label:"计量单位",required:true,options:unitOptions,
      readonly:({mode})=>mode!=="create",
      attrs:{filterable:true,clearable:true}},
    {type:"input",prop:"model",label:"型号"},
    {type:"input",prop:"specification",label:"规格"},
    {type:"input",prop:"note",label:"备注"},
    {type:"select",prop:"status",label:"启停状态",required:true,initialValue:"active",
      options:[{label:"有效",value:"active"},{label:"停用",value:"inactive"}]},
  ],
  async submitForm(input,{mode,id}){
    if(mode==="view")return;
    await saveMaterial(input,id===undefined?undefined:String(id));
  },
};
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  const data=await readMaterial(String(row.id),Boolean(row.deleted));
  return {...data};
}
onMounted(async()=>{
  try{unitOptions.value=await listUnitOptions()}
  catch(e){ElMessage.error((e as Error).message)}
});
</script>
