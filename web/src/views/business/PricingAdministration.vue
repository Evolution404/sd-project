<template>
  <CrudPage ref="crud" :search-config="searchConfig" :table-config="tableConfig">
    <template #table-cell-pricing_mode="{row}">
      {{ modelLabels[row.pricing_mode as PricingMode] || row.pricing_mode }}
    </template>
    <template #table-cell-pricing_scope="{ row }">{{ scopes[row.pricing_scope as keyof typeof scopes] }}</template>
    <template #table-cell-status="{row}">
      <el-tag :type="row.status==='active'?'success':'info'" effect="plain">
        {{row.status==='active'?'启用':'停用'}}
      </el-tag>
    </template>
    <template #table-cell-unit_price_fen="{row}">
      ¥{{fenToYuan(row.unit_price_fen)}}
    </template>
  </CrudPage>
  <PriceRuleEditor v-model="ruleOpen" :id="ruleId" :readonly="ruleReadonly"
    :operations="operations" :voltages="voltages" :materials="materials" :natures="natures" @saved="crud?.refresh()" />
  <el-drawer v-model="historyOpen" title="参考价格正式版本"
    size="min(94vw, 780px)" append-to-body>
    <el-skeleton v-if="historyLoading" animated :rows="6"/>
    <el-empty v-else-if="!history?.versions.length" description="暂无正式历史"/>
    <el-timeline v-else>
      <el-timeline-item v-for="(row,index) in history.versions" :key="index"
        :timestamp="formatBeijingDateTime(row.created_at)" placement="top">
        <el-card shadow="never">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="版本">V{{row.version_no}}</el-descriptions-item>
            <el-descriptions-item label="规则名称">{{row.title}}</el-descriptions-item>
            <el-descriptions-item label="计价模型">
              {{modelLabels[row.pricing_mode]||row.pricing_mode}}
            </el-descriptions-item>
            <el-descriptions-item label="有效日期">{{row.effective_on}}</el-descriptions-item>
            <el-descriptions-item label="计价作用域">{{ scopes[row.pricing_scope] }}</el-descriptions-item>
            <el-descriptions-item label="采用操作版本">V{{ row.operation_version }}</el-descriptions-item>
            <el-descriptions-item label="冻结单位版本">V{{ row.unit_version }}</el-descriptions-item>
            <el-descriptions-item label="价格来源">{{ row.price_source }}</el-descriptions-item>
            <el-descriptions-item label="正式依据">{{ row.basis }}</el-descriptions-item>
            <el-descriptions-item label="基础费（元）">{{fenToYuan(row.base_fee_fen)}}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </el-drawer>
</template>
<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter, activeStatusChoices } from "@/utils/business/native-list-query";
import {ref,onMounted} from "vue";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type {CrudSearchConfig,CrudTableConfig} from "@/components/Crud/types";
import type {OptionItem} from "@/api/common";
import {listStandards, type WorkStandardRow} from "@/api/business/standards";
import {listDictionaries} from "@/api/business/dictionaries";
import {listEquipment} from "@/api/business/equipment";
import {fenToYuan} from "@/api/business/funding";
import {listPrices,priceHistory,type PricingMode} from "@/api/business/pricing";
import { modelLabels } from "@/api/business/price-formula";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import PriceRuleEditor from "@/components/business/PriceRuleEditor.vue";

defineOptions({name:"PricingAdministration"});
const crud = ref<InstanceType<typeof CrudPage>>();
const operations = ref<WorkStandardRow[]>([]);
const voltages = ref<OptionItem[]>([]), materials = ref<OptionItem[]>([]), natures = ref<OptionItem[]>([]);
const historyOpen = ref(false), historyLoading = ref(false);
const history = ref<Awaited<ReturnType<typeof priceHistory>> | null>(null);
const scopes = { work_location: "每作业位置", work_batch: "每批作业", project: "每项目" };
const ruleOpen = ref(false), ruleReadonly = ref(false);
const ruleId = ref<string>();
function openRule(id?: string, readonly = false) {
  ruleId.value = id;
  ruleReadonly.value = readonly;
  ruleOpen.value = true;
}
async function showHistory(id:string){
  historyOpen.value=true;historyLoading.value=true;history.value=null;
  try{history.value=await priceHistory(id) }
  catch(e){ElMessage.error((e as Error).message)}
  finally{historyLoading.value=false}
}
const searchConfig:CrudSearchConfig={fields:[{
  type:"input",prop:"keywords",label:"搜索规则",attrs:{clearable:true,
    placeholder:"规则名称 / 编号 / 价格依据"},
},
    historyScopeField("pricing.show-deleted"),
  ]};
const tableConfig:CrudTableConfig={
  stateKey:"prices",
  table:{border:true},rowKey:"id",
  fetchData:async query=>{
    const q=query as {pageNum?:number;pageSize?:number;keywords?:string};
    const result=await listPrices({page:q.pageNum||1,
      size:q.pageSize||20,keyword:q.keywords||"",...nativeListQuery(query, ["status"])});
    return {list:result.items,total:result.total};
  },
  toolbarActions:[{key:"create-rule",label:"新增参考价格",permission:"admin",onClick:()=>openRule()}],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"code",sortable:"custom",label:"规则编号",minWidth:145,fixed:"left"},
    {prop:"title",sortable:"custom",label:"规则名称",minWidth:220},
    {prop:"operation_id_label",sortable:"custom",label:"操作类型",minWidth:210},
    {prop:"pricing_mode",sortable:"custom",label:"计价模型",cellType:"custom",minWidth:150},
    {prop:"pricing_scope",sortable:"custom",label:"计价作用域",cellType:"custom",width:145},
    {prop:"unit_price_fen",sortable:"custom",label:"单位价格",cellType:"custom",width:135},
    {prop:"effective_on",sortable:"custom",label:"生效日期",width:145},
    {prop:"version_no",sortable:"custom",label:"正式版本",width:110},
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",activeStatusChoices),label:"状态",cellType:"custom",width:100},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:230,actions:[
      {key:"view-rule",label:"查看",permission:"read",onClick:({row})=>row&&openRule(String(row.id),true)},
      {key:"edit-rule",label:"修订",permission:"admin",onClick:({row})=>row&&openRule(String(row.id))},
      {key:"history",label:"历史",permission:"read",
        onClick:({row})=>row&&showHistory(String(row.id))},
    ]},
  ],
};
onMounted(async () => {
  try {
    const [available, voltageRows, materialRows, natureRows] = await Promise.all([
      listStandards("operations", { size: 500 }), listEquipment("voltages", { size: 500 }),
      listDictionaries("tower_materials", { size: 500 }), listDictionaries("tower_natures", { size: 500 }),
    ]);
    operations.value = available.items.filter(row => row.status === "active");
    voltages.value = voltageRows.items.filter(row => row.status === "active").map(row => ({ label: row.name || row.label, value: row.id }));
    materials.value = materialRows.items.filter(row => row.status === "active").map(row => ({ label: row.name, value: row.id }));
    natures.value = natureRows.items.filter(row => row.status === "active").map(row => ({ label: row.name, value: row.id }));
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  }
});
</script>
