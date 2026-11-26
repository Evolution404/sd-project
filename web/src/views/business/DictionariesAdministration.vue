<template>
  <div class="page-container">
    <DemandSetupNavigation />
    <el-card shadow="never">
      <el-tabs v-model="kind">
        <el-tab-pane v-for="tab in tabs" :key="tab.key"
          :name="tab.key" :label="tab.label"/>
      </el-tabs>
    </el-card>
    <OrganizationDirectory v-if="kind === 'organizations'" />
    <CrudPage embedded
      v-else
      :key="kind" ref="crud"
      :search-config="searchConfig"
      :table-config="tableConfig"
      :form-config="formConfig"
      :load-form-data="loadForm"
    >
      <template #table-cell-status="{row}">
        <el-tag :type="row.status==='active'?'success':'info'" effect="plain">
          {{ row.status==='active'?'启用':'停用' }}
        </el-tag>
      </template>
      <template #table-cell-quantity_precision="{row}">
        {{ row.quantity_precision === 0 ? "整数" : "最多 "+row.quantity_precision+" 位小数" }}
      </template>
      <template #table-cell-changed_at="{row}">{{ formatBeijingDateTime(row.changed_at) }}</template>
    </CrudPage>
    <VersionedBatchWorksheet v-if="batchOpen" ref="batchEditor" :config="batchConfig" :revise="batchRevise"
      @close="batchOpen = false" @saved="batchOpen = false; crud?.refresh()" />
    <el-drawer v-model="historyVisible" :title="title+'正式版本历史'"
      size="650px" append-to-body>
      <el-skeleton v-if="historyLoading" animated :rows="6"/>
      <el-empty v-else-if="!detail?.versions.length" description="暂无版本历史"/>
      <el-timeline v-else>
        <el-timeline-item v-for="v in detail?.versions || []" :key="v.id"
          :timestamp="formatBeijingDateTime(v.changed_at)" type="primary" placement="top">
          <el-card shadow="never">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="版本">V{{ v.version }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ v.status==='active'?'启用':'停用' }}</el-descriptions-item>
              <el-descriptions-item label="名称" :span="2">{{ v.name }}</el-descriptions-item>
              <el-descriptions-item v-if="kind==='units'" label="数量精度" :span="2">
                {{ v.quantity_precision===0?"整数":"最多 "+v.quantity_precision+" 位小数" }}
              </el-descriptions-item>
              <el-descriptions-item label="变更原因" :span="2">{{ v.reason||"—" }}</el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { nativeListQuery, nativeColumnFilter, activeStatusChoices } from "@/utils/business/native-list-query";
import {computed,defineAsyncComponent,ref} from "vue";
import type { VersionedBatchEntryConfig } from "@/components/business/versioned-batch-entry";
import { usePageOverlays } from "@/composables/usePageOverlays";
import CrudPage from "@/components/Crud/CrudPage.vue";
import DemandSetupNavigation from "@/components/business/DemandSetupNavigation.vue";
import OrganizationDirectory from "@/components/business/OrganizationDirectory.vue";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import type {CrudRecord,CrudSearchConfig,CrudTableConfig,CrudFormConfig} from "@/components/Crud/types";
import {
  listDictionaries,readDictionary,dictionaryDetail,
  saveDictionary,removeDictionary,
  type DictionaryKind,type DictionaryRow,type DictionaryForm,type DictionaryDetail,
} from "@/api/business/dictionaries";

defineOptions({name:"DictionariesAdministration"});
const tabs=[
  {key:"units",label:"计量单位"},
  {key:"priorities",label:"优先级"},
  {key:"categories",label:"项目类别"},
  {key:"tower_natures",label:"杆塔性质"},
  {key:"tower_materials",label:"杆塔材质"},
  {key:"organizations",label:"组织目录"},
] as const;
const kind=ref<DictionaryKind | "organizations">("units");
const dictionaryKind=computed<DictionaryKind>(()=>kind.value==="organizations"?"units":kind.value);
const title=computed(()=>tabs.find(tab=>tab.key===kind.value)?.label||"基础数据");
const crud = ref<InstanceType<typeof CrudPage>>();
const VersionedBatchWorksheet = defineAsyncComponent(() => import("@/components/business/VersionedBatchWorksheet.vue"));
const batchOpen = ref(false), batchRevise = ref(false), batchKind = ref<DictionaryKind>("units");
const batchEditor = ref<InstanceType<typeof VersionedBatchWorksheet>>();
const batchTitle = ref("");
function openBatch(revise: boolean) {
  batchKind.value = dictionaryKind.value;
  batchTitle.value = title.value;
  batchRevise.value = revise;
  batchOpen.value = true;
}
usePageOverlays([batchOpen], { mayLeave: () => batchOpen.value ? batchEditor.value?.mayLeave() ?? true : true });
const batchConfig = computed<VersionedBatchEntryConfig>(() => ({
  title: (batchRevise.value ? "批量修订" : "批量新增") + batchTitle.value,
  endpoint: "/api/catalog/" + batchKind.value + "/entry-batch",
  columns: [
    { key: "name", title: batchTitle.value + "名称", width: 245, required: true, editable: true },
    ...(batchKind.value === "units" ? [{
      key: "quantity_precision", title: "允许小数位数", width: 160, required: true, editable: true, numeric: true,
    }] : []),
    { key: "reason", title: "变更原因", width: 285, editable: true },
  ],
  initial: (): Record<string,string> => batchKind.value === "units" ? { quantity_precision: "0" } : {},
  async choices(keyword,page) {
    const result = await listDictionaries(batchKind.value, { keyword, page, size: 20 });
    return { total: result.total, items: result.items.map(row => ({
      id: row.id, code: row.code, name: row.name, version: row.version,
      fields: { name: row.name, quantity_precision: String(row.quantity_precision ?? 0), reason: "" },
    })) };
  },
  values(fields) {
    const values: Record<string, unknown> = { name: fields.name.trim(), reason: fields.reason || "" };
    if (batchKind.value === "units") {
      if (!/^[0-4]$/.test(fields.quantity_precision)) throw Object.assign(Error("允许小数位数必须为 0 至 4"), { field: "quantity_precision" });
      values.quantity_precision = Number(fields.quantity_precision);
    }
    return values;
  },
}));
const historyVisible=ref(false),historyLoading=ref(false);
const detail=ref<DictionaryDetail|null>(null);
async function showHistory(id:string) {
  historyVisible.value=true;historyLoading.value=true;detail.value=null;
  try{detail.value=await dictionaryDetail(dictionaryKind.value,id)}
  catch(e){ElMessage.error((e as Error).message)}
  finally{historyLoading.value=false}
}
const searchConfig = computed<CrudSearchConfig>(() => ({
  fields:[
    {type:"input",prop:"keywords",label:"搜索",attrs:{clearable:true,
      placeholder:"名称 / 编号"}},
    {type:"select",prop:"status",label:"状态",attrs:{clearable:true},
      options:[{label:"启用",value:"active"},{label:"停用",value:"inactive"}]},
    ...(kind.value === "units" ? [{
      type: "select" as const, prop: "quantity_precision", label: "数量精度", attrs: { clearable: true },
      options: ["整数", "1 位小数", "2 位小数", "3 位小数", "4 位小数"].map((label, value) => ({ label, value: String(value) })),
    }] : []),
  ],
}));
const tableConfig=computed<CrudTableConfig>(()=>({
  stateKey:"dictionaries"+":"+kind.value,
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const p=query as {pageNum?:number;pageSize?:number;keywords?:string;status?:string};
    const data=await listDictionaries(dictionaryKind.value,{
      page:p.pageNum||1,size:p.pageSize||20,keyword:p.keywords||"",status:p.status,
      ...nativeListQuery(query, ["status"], false, kind.value === "units" ? ["quantity_precision"] : []),
    });
    return {list:data.items,total:data.total};
  },
  toolbarActions:[
    {key:"create",label:"新增"+title.value,permission:"admin"},
    {key:"batch-create",label:"批量新增",permission:"admin",onClick:()=>openBatch(false)},
    {key:"batch-revise",label:"批量修订",permission:"admin",onClick:()=>openBatch(true)},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"code",sortable:"custom",label:"编号",minWidth:140,fixed:"left"},
    {prop:"name",sortable:"custom",label:title.value+"名称",minWidth:190},
    ...(kind.value==="units"?[{prop:"quantity_precision",label:"数量格式",
      cellType:"custom" as const,minWidth:160}]:[]),
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",activeStatusChoices),label:"状态",cellType:"custom",width:90},
    {prop:"version",sortable:"custom",label:"版本",width:85},
    {prop:"changed_at",label:"最后修改",cellType:"custom",minWidth:175},
    {prop:"actions",label:"操作",cellType:"actions",width:220,fixed:"right",actions:[
      {key:"view",label:"查看",permission:"read"},
      {key:"edit",label:"修订",permission:"admin"},
      {key:"history",label:"历史",permission:"read",
        onClick:({row})=>row&&showHistory(String(row.id))},
      {key:"delete",label:"删除",permission:"admin"},
    ]},
  ],
  deleteByIds:async ids=>{
    for(const id of ids.split(",")) {
      const {impact,commit}=await removeDictionary(dictionaryKind.value,id);
      await ElMessageBox.confirm(
        impact.references
          ? `此${title.value}已被${impact.references}条正式记录引用，删除只会阻止新选择，不改历史。确认？`
          : `确认删除此${title.value}？正式历史将保留。`,
        "删除影响确认",{type:"warning"});
      await commit();
    }
  },
}));
const formConfig=computed<CrudFormConfig<DictionaryForm>>(()=>({
  title:({mode})=>({create:"新增",edit:"修订",view:"查看"})[mode]+title.value,
  rowKey:"id",dialog:{width:610},
  fields:[
    {type:"input-number",prop:"version",label:"正式版本号",hidden:true},
    {type:"input",prop:"code",label:"编号",visible:({mode})=>mode!=="create",readonly:true},
    {type:"input",prop:"name",label:title.value+"名称",required:true},
    ...(kind.value==="units" ? [{
      type:"input-number" as const,prop:"quantity_precision",label:"允许小数位数",
      required:true,initialValue:0,attrs:{min:0,max:4,step:1,precision:0},
      tips:"0 表示只能输入整数；1～4 表示允许对应的小数位数",
    }] : []),
    {type:"radio",prop:"status",label:"状态",initialValue:"active",
      options:[{label:"启用",value:"active"},{label:"停用",value:"inactive"}]},
    {type:"input",prop:"reason",label:"变更原因"},
  ],
  async submitForm(form,{mode,id}){
    if(mode==="view")return;
    await saveDictionary(dictionaryKind.value,form,id===undefined?undefined:String(id));
  },
}));
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  const item:DictionaryRow=await readDictionary(dictionaryKind.value,String(row.id));
  return {...item,quantity_precision:item.quantity_precision??0};
}
</script>
