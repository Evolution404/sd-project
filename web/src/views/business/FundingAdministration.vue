<template>
  <div class="page-container">
  <DemandSetupNavigation />
  <CrudPage embedded
    :key="kind"
    ref="crud"
    :search-config="searchConfig"
    :table-config="tableConfig"
    :form-config="formConfig"
    :load-form-data="loadForm"
  >
    <template #table-cell-created_at="{row}">{{ formatBeijingDateTime(row.created_at) }}</template>
    <template #table-cell-status="{row}">
      <el-tag :type="row.status==='active'?'success':'info'" effect="plain">
        {{ row.status==='active'?'启用':'停用' }}
      </el-tag>
    </template>
    <template #table-cell-limit_fen="{row}">
      ¥{{ fenToYuan(row.limit_fen) }}
    </template>
    <template #table-cell-framework_id="{row}">
      {{ frameworkNames[row.framework_id] || row.framework_id || "—" }}
    </template>
  </CrudPage>

  <VersionedBatchWorksheet v-if="batchOpen" ref="batchEditor" :config="batchConfig" :revise="batchRevise"
    @close="batchOpen = false" @saved="batchOpen = false; crud?.refresh()">
    <el-form v-if="kind === 'agreements' && !batchRevise" novalidate inline>
      <el-form-item label="所属年度框架">
        <el-select v-model="batchFramework" filterable placeholder="选择年度框架" style="width:240px">
          <el-option v-for="option in frameworkOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
    </el-form>
  </VersionedBatchWorksheet>
  <el-drawer v-model="historyVisible" :title="title+'正式版本历史'"
    size="670px" append-to-body>
    <el-skeleton v-if="historyLoading" animated :rows="6"/>
    <el-empty v-else-if="!history.length" description="暂无版本历史"/>
    <el-timeline v-else>
      <el-timeline-item v-for="entry in history" :key="entry.id"
        :timestamp="formatBeijingDateTime(entry.recorded_at)" type="primary" placement="top">
        <el-card shadow="never">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="版本">V{{ entry.version_no }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              {{ entry.status==='active'?'启用':'停用' }}
            </el-descriptions-item>
            <el-descriptions-item label="名称">{{ entry.name }}</el-descriptions-item>
            <el-descriptions-item label="额度">¥{{ fenToYuan(entry.limit_fen) }}</el-descriptions-item>
            <el-descriptions-item label="变更原因" :span="2">
              {{ entry.reason || "—" }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </el-drawer>

  <el-drawer v-model="detailsVisible" :title="title+'资金与项目归属'"
    size="720px" append-to-body>
    <el-skeleton v-if="detailsLoading" animated :rows="8"/>
    <template v-else-if="details">
      <el-descriptions border :column="2">
        <el-descriptions-item label="项目数量">{{ details.summary.project_count }}</el-descriptions-item>
        <el-descriptions-item label="批准预算">
          ¥{{ fenToYuan(details.summary.approved_budget_fen) }}
        </el-descriptions-item>
        <el-descriptions-item label="实际费用">
          ¥{{ fenToYuan(details.summary.actual_cost_fen) }}
        </el-descriptions-item>
        <el-descriptions-item label="累计结算">
          ¥{{ fenToYuan(details.summary.settlement_fen) }}
        </el-descriptions-item>
        <el-descriptions-item label="可用余额" :span="2">
          ¥{{ fenToYuan(details.summary.capacity_difference_fen) }}
        </el-descriptions-item>
      </el-descriptions>
      <el-button v-if="kind === 'agreements'" class="mt-3" link type="primary" @click="openFramework">查看所属年度框架</el-button>
      <el-divider>关联项目与协议</el-divider>
      <el-empty v-if="!details.projects.length&&!details.agreements.length"
        description="暂无关联项目或协议"/>
      <el-table v-if="details.projects.length" :data="details.projects" border size="small">
        <el-table-column label="关联子项目" min-width="190">
          <template #default="{ row }">
            <el-button link type="primary" @click="openProject(row.id)">{{ row.name }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="display_status" label="项目状态" width="130"/>
      </el-table>
      <el-table v-if="details.agreements.length" :data="details.agreements" border size="small">
        <el-table-column label="关联执行协议" min-width="190">
          <template #default="{ row }">
            <el-button link type="primary" @click="openAgreement(row.id)">{{ row.name }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="编号" width="160"/>
      </el-table>
    </template>
  </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter, activeStatusChoices } from "@/utils/business/native-list-query";
import {computed,defineAsyncComponent,ref,reactive,onMounted,onActivated} from "vue";
import {useRoute,useRouter} from "vue-router";
import { usePageOverlays } from "@/composables/usePageOverlays";
import type { VersionedBatchEntryConfig } from "@/components/business/versioned-batch-entry";
import CrudPage from "@/components/Crud/CrudPage.vue";
import DemandSetupNavigation from "@/components/business/DemandSetupNavigation.vue";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import type {CrudFormConfig,CrudRecord,CrudSearchConfig,CrudTableConfig} from "@/components/Crud/types";
import type {OptionItem} from "@/api/common";
import {
  listFunding,getFunding,getFundingDetails,getFundingHistory,saveFunding,removeFunding,
  fenToYuan,yuanToFen,type FundingKind,type FundingForm,type FundingRow,type FundingDetails,
} from "@/api/business/funding";

defineOptions({name:"FundingAdministration"});
const route=useRoute();
const router=useRouter();
const kind:FundingKind=route.path.includes("/agreements")?"agreements":"frameworks";
const initialRecord=typeof route.query.funding==="string"?route.query.funding:undefined;
const title=kind==="frameworks"?"年度框架":"执行协议";
const frameworkOptions=ref<OptionItem[]>([]);
const frameworkNames=reactive<Record<string,string>>({});
const crud = ref<InstanceType<typeof CrudPage>>();
const VersionedBatchWorksheet = defineAsyncComponent(() => import("@/components/business/VersionedBatchWorksheet.vue"));
const batchEditor = ref<InstanceType<typeof VersionedBatchWorksheet>>();
const batchOpen = ref(false), batchRevise = ref(false), batchFramework = ref("");
function openBatch(revise: boolean) {
  batchRevise.value = revise;
  batchFramework.value = "";
  batchOpen.value = true;
}
const batchConfig = computed<VersionedBatchEntryConfig>(() => ({
  title: (batchRevise.value ? "批量修订" : "批量新增") + title,
  endpoint: "/api/funding/" + kind + "/entry-batch",
  createReady: kind === "frameworks" || Boolean(batchFramework.value),
  columns: [
    { key: "name", title: title + "名称", width: 215, editable: true, required: true },
    { key: "limit_fen", title: "额度（元）", width: 145, editable: true, required: true, numeric: true },
    ...(kind === "frameworks" ? [{
      key: "fiscal_year", title: "年度", width: 115, editable: !batchRevise.value, required: true, numeric: true,
    }] : [
      { key: "contract_number", title: "合同编号", width: 145, editable: true },
      { key: "counterparty_name", title: "合同对方", width: 195, editable: true },
      { key: "signed_on", title: "签订日期", width: 135, editable: true },
      { key: "effective_from", title: "生效日期", width: 135, editable: true },
      { key: "effective_to", title: "截止日期", width: 135, editable: true },
    ]),
    { key: "reason", title: "变更说明", width: 250, editable: true },
  ],
  initial: () => ({}),
  async choices(keyword, page) {
    const result = await listFunding(kind, { keyword, page, size: 20 });
    return { total: result.total, items: result.items.map(row => ({
      id: row.id, code: row.code, name: row.name, version: row.version_no,
      context: row.framework_id ? frameworkNames[row.framework_id] : undefined,
      fields: { name: row.name, limit_fen: fenToYuan(row.limit_fen), fiscal_year: String(row.fiscal_year ?? ""),
        contract_number: row.contract_number || "", counterparty_name: row.counterparty_name || "",
        signed_on: row.signed_on || "", effective_from: row.effective_from || "", effective_to: row.effective_to || "", reason: "" },
    })) };
  },
  values(fields, record) {
    let limit_fen: number;
    try { limit_fen = yuanToFen(fields.limit_fen); }
    catch (cause) { throw Object.assign(cause as Error, { field: "limit_fen" }); }
    const values: Record<string, unknown> = { name: fields.name.trim(), limit_fen, reason: fields.reason || "" };
    if (kind === "frameworks" && !record) {
      if (!/^\d{4}$/.test(fields.fiscal_year) || Number(fields.fiscal_year) < 2000 || Number(fields.fiscal_year) > 2100)
        throw Object.assign(Error("年度须为 2000 至 2100"), { field: "fiscal_year" });
      values.fiscal_year = Number(fields.fiscal_year);
    }
    if (kind === "agreements") {
      if (!record) values.framework_id = batchFramework.value;
      for (const key of ["contract_number", "counterparty_name"]) values[key] = fields[key] || "";
      for (const key of ["signed_on", "effective_from", "effective_to"]) values[key] = fields[key] || null;
    }
    return values;
  },
}));
const historyVisible=ref(false),historyLoading=ref(false);
const history=ref<Array<{id:string;version_no:number;name:string;status:string;
  limit_fen:number;recorded_at:string;reason?:string}>>([]);
const detailsVisible=ref(false),detailsLoading=ref(false);
const details=ref<FundingDetails|null>(null);
let returnRecord:string|undefined;
let detailSequence=0,historySequence=0;
usePageOverlays([batchOpen,historyVisible,detailsVisible],{mayLeave:()=>batchOpen.value?batchEditor.value?.mayLeave()??true:true,invalidate:()=>{
  detailSequence++;historySequence++;
  detailsLoading.value=false;historyLoading.value=false;
  details.value=null;history.value=[];
}});
async function openHistory(id:string) {
  const sequence=++historySequence;
  historyVisible.value=true;historyLoading.value=true;history.value=[];
  try{
    const rows=await getFundingHistory(kind,id) as typeof history.value;
    if(sequence===historySequence)history.value=rows;
  }catch(e){if(sequence===historySequence)ElMessage.error((e as Error).message)}
  finally{if(sequence===historySequence)historyLoading.value=false}
}
async function openDetails(id:string) {
  const sequence=++detailSequence;
  detailsVisible.value=true;detailsLoading.value=true;details.value=null;
  try{
    const data=await getFundingDetails(kind,id);
    if(sequence===detailSequence)details.value=data;
  }
  catch(e){if(sequence===detailSequence)ElMessage.error((e as Error).message)}
  finally{if(sequence===detailSequence)detailsLoading.value=false}
}
function openProject(id:string) {
  returnRecord=details.value?.item.id;
  detailsVisible.value=false;
  return router.push({name:"Projects",query:{project:id,sourceFunding:kind,funding:returnRecord}});
}
function openAgreement(id:string) {
  returnRecord=details.value?.item.id;
  detailsVisible.value=false;
  return router.push({name:"Agreements",query:{funding:id}});
}
function openFramework() {
  const id=details.value?.item.framework_id;
  if(!id)return;
  returnRecord=details.value?.item.id;
  detailsVisible.value=false;
  return router.push({name:"Frameworks",query:{funding:id}});
}
onMounted(()=>{if(initialRecord)void openDetails(initialRecord)});
onActivated(()=>{
  if(!returnRecord)return;
  const id=returnRecord;
  returnRecord=undefined;
  void openDetails(id);
});
const searchConfig:CrudSearchConfig={
  fields:[
    {type:"input",prop:"keywords",label:"搜索",attrs:{
      placeholder:"编号 / 名称",clearable:true,
    }},
    {type:"select",prop:"status",label:"状态",attrs:{clearable:true},
      options:[{label:"启用",value:"active"},{label:"停用",value:"inactive"}]},
    historyScopeField(kind==="frameworks"?"frameworks.show-deleted":"agreements.show-deleted"),
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"funding"+":"+kind,
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const params=query as {pageNum?:number;pageSize?:number;keywords?:string;status?:string};
    const response=await listFunding(kind,{page:params.pageNum||1,size:params.pageSize||20,
      keyword:params.keywords||"",status:params.status,...nativeListQuery(query, ["status"])});
    return {list:response.items,total:response.total};
  },
  toolbarActions:[
    {key:"create",label:"新增"+title,permission:"write"},
    {key:"batch-create",label:"批量新增",permission:"write",onClick:()=>openBatch(false)},
    {key:"batch-revise",label:"批量修订",permission:"write",onClick:()=>openBatch(true)},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"code",sortable:"custom",label:"编号",minWidth:135,fixed:"left"},
    {prop:"name",sortable:"custom",label:title+"名称",minWidth:190},
    ...(kind==="frameworks"
      ? [{prop:"fiscal_year",sortable:"custom",label:"年度",width:100}]
      : [{prop:"framework_id",label:"所属框架",cellType:"custom" as const,minWidth:180},
        {prop:"contract_number",sortable:"custom",label:"合同编号",minWidth:150},
        {prop:"effective_to",sortable:"custom",label:"截止日期",width:140}]),
    {prop:"limit_fen",sortable:"custom",label:"额度",cellType:"custom",minWidth:135},
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",activeStatusChoices),label:"状态",cellType:"custom",width:98},
    {prop:"version_no",label:"正式版本",width:100},
    {prop:"created_at",sortable:"custom",label:"创建时间",cellType:"custom",minWidth:175},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:285,actions:[
      {key:"view",label:"查看",permission:"read"},
      {key:"edit",label:"修订",permission:"write"},
      {key:"details",label:"项目资金",permission:"read",visible:({row})=>!row?.deleted,
        onClick:({row})=>row&&openDetails(String(row.id))},
      {key:"history",label:"历史",permission:"read",
        onClick:({row})=>row&&openHistory(String(row.id))},
      {key:"delete",label:"删除",permission:"admin"},
    ]},
  ],
  deleteByIds:async ids=>{
    for(const id of ids.split(",")){
      const {impact,commit}=await removeFunding(kind,id);
      const references=impact.projects.length+impact.agreements.length;
      await ElMessageBox.confirm(references
        ? `该${title}关联${impact.projects.length}个项目及${impact.agreements.length}份协议，确认按服务端校验后的影响范围逻辑删除？`
        : `确认删除此${title}？操作保留历史与审计。`,
      "删除影响确认",{type:"warning"});
      await commit();
    }
  },
};
const formFields:NonNullable<CrudFormConfig<FundingForm>["fields"]>=[
  {type:"input-number",prop:"version_no",label:"正式版本号",hidden:true},
  {type:"input",prop:"code",label:"编号",visible:({mode})=>mode!=="create",readonly:true},
  {type:"input",prop:"name",label:title+"名称",required:true},
  ...(kind==="frameworks"?
    [{type:"input-number" as const,prop:"fiscal_year",label:"年度",required:true,
      readonly:({mode}:{mode:string})=>mode!=="create",
      attrs:{min:2000,max:2100,precision:0,step:1}}]:
    [{type:"select" as const,prop:"framework_id",label:"所属年度框架",required:true,
      options:frameworkOptions,readonly:({mode}:{mode:string})=>mode!=="create",
      attrs:{filterable:true,clearable:true}},
     {type:"input" as const,prop:"contract_number",label:"合同编号"},
     {type:"input" as const,prop:"counterparty_name",label:"合同对方"},
     {type:"date-picker" as const,prop:"signed_on",label:"签订日期",attrs:{valueFormat:"YYYY-MM-DD"}},
     {type:"date-picker" as const,prop:"effective_from",label:"生效日期",attrs:{valueFormat:"YYYY-MM-DD"}},
     {type:"date-picker" as const,prop:"effective_to",label:"截止日期",attrs:{valueFormat:"YYYY-MM-DD"}}]),
  {type:"input",prop:"budget_yuan",label:"额度（元）",required:true,
    attrs:{placeholder:"例：150000.00"},
    tips:"使用人民币元填写，最多两位小数；保存为精确整数分"},
  {type:"radio",prop:"status",label:"状态",initialValue:"active",
    options:[{label:"启用",value:"active"},{label:"停用",value:"inactive"}]},
  {type:"input",prop:"reason",label:"变更说明"},
];
const formConfig:CrudFormConfig<FundingForm>={
  title:({mode})=>({create:"新增",edit:"修订",view:"查看"})[mode]+title,
  rowKey:"id",dialog:{width:700},fields:formFields,
  async submitForm(data,{mode,id}){
    if(mode==="view")return;
    await saveFunding(kind,data,id===undefined?undefined:String(id));
  },
};
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  const record:FundingRow=await getFunding(kind,String(row.id),Boolean(row.deleted));
  return {...record,budget_yuan:fenToYuan(record.limit_fen),
    signed_on:record.signed_on||undefined,effective_from:record.effective_from||undefined,
    effective_to:record.effective_to||undefined};
}
onMounted(async()=>{
  try{
    if(kind==="agreements"){
      const response=await listFunding("frameworks",{size:500});
      frameworkOptions.value=response.items.filter(row=>row.status==="active")
        .map(row=>({value:row.id,label:row.name}));
      for(const row of response.items) frameworkNames[row.id]=row.name;
    }
  }catch(e){ElMessage.error((e as Error).message)}
});
</script>
