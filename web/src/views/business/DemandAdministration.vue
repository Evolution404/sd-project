<template>
  <CrudPage
    ref="crudRef"
    :search-config="searchConfig"
    :table-config="tableConfig"
  >
    <template #table-cell-display_status="{ row }">
      <el-tag :type="statusColor(row.display_status)" effect="plain">
        {{ row.display_status }}
      </el-tag>
    </template>
    <template #table-cell-problem_description="{ row }">
      <el-link type="primary" :underline="false" @click="openDetail(String(row.id),Boolean(row.deleted))">
        {{ row.problem_description }}
      </el-link>
    </template>
  </CrudPage>
  <HandlingBatchDialog v-if="batchTargets" kind="demands" :targets="batchTargets" @close="batchTargets=null" @changed="crudRef?.refresh(true)" />
  <BusinessExchangeDialog v-if="exchangeOpen" kind="demands" :applied-query="appliedQuery" :selected-ids="exchangeIds"
    @close="exchangeOpen = false" @changed="crudRef?.refresh()" />

  <el-drawer
    v-model="detailVisible"
    :title="detail ? `专业需求 ${detail.demand_no}` : '专业需求详情'"
    size="min(100%, 1000px)"
    append-to-body
  >
    <el-skeleton v-if="detailLoading" animated :rows="8" />
    <el-alert v-if="detailError" :closable="false" type="error" :title="detailError" />
    <template v-if="detail && !detailLoading">
      <el-descriptions :data-guide-record="`demand/${detail.id}`" border :column="2" class="mb-4">
        <el-descriptions-item label="需求编号">{{ detail.demand_no }}</el-descriptions-item>
        <el-descriptions-item label="需求状态">
          <el-tag :type="statusColor(detail.display_status)">{{ detail.display_status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="正式版本">V{{ detail.current_version }}</el-descriptions-item>
        <el-descriptions-item label="操作类型">{{ detail.operation_snapshot }}</el-descriptions-item>
        <el-descriptions-item label="作业对象">{{ detail.work_object_snapshot }}</el-descriptions-item>
        <el-descriptions-item label="处理部位">{{ detail.target_object }}</el-descriptions-item>
        <el-descriptions-item label="工作量">{{ quantityText(detail.quantity_scaled) }} {{ detail.unit_snapshot }}</el-descriptions-item>
        <el-descriptions-item label="预计解决时间">{{ detail.expected_on || "—" }}</el-descriptions-item>
        <el-descriptions-item label="问题描述" :span="2">{{ detail.problem_description }}</el-descriptions-item>
        <el-descriptions-item label="验收标准" :span="2">{{ detail.completion_standard }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.binding" label="关联项目" :span="2">
          <el-button data-guide-action="demands.open-linked" link type="primary" @click="openProject(detail.binding.project_id)">
            {{ detail.project_name || "查看当前承接项目" }}
          </el-button>
        </el-descriptions-item>
      </el-descriptions>

      <el-tabs v-model="activeTab" @tab-change="tabChanged">
        <el-tab-pane :label="`作业位置（${detail.work_locations.length}）`" name="locations">
          <el-table :data="detail.work_locations" border height="400" row-key="item_no">
            <el-table-column prop="item_no" label="序号" width="66" fixed="left" />
            <el-table-column label="位置类型" width="112">
              <template #default="{row}">{{ locationKindText(row.location_kind) }}</template>
            </el-table-column>
            <el-table-column label="线路" min-width="145">
              <template #default="{row}">{{ row.location_snapshot_json.line_name || "—" }}</template>
            </el-table-column>
            <el-table-column label="正式作业点位" min-width="190">
              <template #default="{row}">{{ locationDisplayFields(row.location_kind,row.location_snapshot_json).location_label }}</template>
            </el-table-column>
            <el-table-column v-if="detail.work_locations.some(row=>row.location_kind==='span')" label="起点杆塔号" min-width="115"><template #default="{row}">{{locationDisplayFields(row.location_kind,row.location_snapshot_json).start_tower_no}}</template></el-table-column>
            <el-table-column v-if="detail.work_locations.some(row=>row.location_kind==='span')" label="终点杆塔号" min-width="115"><template #default="{row}">{{locationDisplayFields(row.location_kind,row.location_snapshot_json).end_tower_no}}</template></el-table-column>
            <el-table-column label="需求量" min-width="118" align="right">
              <template #default="{row}">{{ quantityText(row.quantity_scaled) }} {{ detail.unit_snapshot }}</template>
            </el-table-column>
            <el-table-column label="已解决量" min-width="118" align="right">
              <template #default="{row}">{{ quantityText(row.resolved_quantity_scaled ?? 0) }}</template>
            </el-table-column>
            <el-table-column label="剩余量" min-width="118" align="right">
              <template #default="{row}">{{ quantityText(row.remaining_quantity_scaled ?? row.quantity_scaled) }}</template>
            </el-table-column>
            <el-table-column label="作业方式" width="125">
              <template #default="{row}">{{ workModeText(row.work_mode) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`预计物资（${detail.materials.length}）`" name="materials">
          <el-table :data="detail.materials" border row-key="item_no">
            <el-table-column prop="item_no" label="序号" width="70" />
            <el-table-column prop="material_name" label="物资名称" min-width="170" />
            <el-table-column prop="model" label="物资型号" min-width="130" />
            <el-table-column prop="specification" label="物资规格" min-width="130" />
            <el-table-column label="数量" width="145" align="right">
              <template #default="{row}">{{ quantityText(row.quantity_scaled) }}</template>
            </el-table-column>
            <el-table-column prop="note" label="说明" min-width="150" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`来源（${detail.sources.length}）`" name="sources">
          <el-table :data="detail.sources" border row-key="id">
            <el-table-column prop="description" label="来源说明" min-width="260" />
            <el-table-column prop="discovered_on" label="发现日期" width="140" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="附件" name="evidence" lazy>
          <BusinessEvidence :key="detail.id" :owner="detail.id" kind="demand_id" :readonly="detail.deleted" />
        </el-tab-pane>
        <el-tab-pane name="history" label="正式历史">
          <el-button data-guide-action="demands.history" :loading="historyLoading" @click="loadHistory">刷新正式历史</el-button>
          <el-timeline class="mt-4">
            <el-timeline-item v-for="event in history?.events ?? []" :key="event.event_seq"
              :timestamp="formatBeijingDateTime(event.recorded_at)" placement="top">
              第 {{ event.event_seq }} 次状态事件：{{ lifecycleLabel(event.to_status) }}
            </el-timeline-item>
          </el-timeline>
          <el-empty v-if="!historyLoading && !(history?.events.length ?? 0)" description="暂无生命周期事件" />
        </el-tab-pane>
      </el-tabs>
    </template>
    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <el-button @click="detailVisible=false">关闭</el-button>
        <el-button data-guide-action="demands.edit" v-if="canWrite && detail && !detail.deleted && detail.status !== 'cancelled'"
          @click="editDemand(detail.id)">正式修订</el-button>
        <el-button v-if="canWrite && detail && !detail.deleted && detail.status === 'active' &&
          !detail.binding && (detail.remaining_quantity_scaled ?? detail.quantity_scaled) > 0"
          data-guide-action="demands.project-create" type="primary" @click="createProject(detail.id)">创建子项目并承接</el-button>
        <el-button data-guide-action="demands.return" v-if="canConfirm && detail && !detail.deleted && ['pending', 'active'].includes(detail.status) && !detail.binding"
          :disabled="saving" @click="changeLifecycle('returned')">退回需求</el-button>
        <el-button data-guide-action="demands.cancel" v-if="canConfirm && detail && !detail.deleted && detail.status !== 'cancelled' && !detail.binding"
          :disabled="saving" @click="changeLifecycle('cancelled')">取消需求</el-button>
        <el-button
 data-guide-action="demands.confirm"          v-if="canConfirm && detail && !detail.deleted && ['pending', 'returned'].includes(detail.status) && !detail.binding"
          type="primary"
          :loading="saving"
          @click="confirmDetail"
        >确认专业需求</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { locationDisplayFields } from "../../../../server/shared/location-display";

import { historyScopeField, nativeListQuery, nativeColumnFilter, applyNativeListQuery } from "@/utils/business/native-list-query";
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import CrudPage from "@/components/Crud/CrudPage.vue";
import HandlingBatchDialog from "@/components/business/HandlingBatchDialog.vue";
import type { HandlingTarget } from "@/api/business/handling-batch";
import BusinessExchangeDialog from "@/components/business/BusinessExchangeDialog.vue";
import BusinessEvidence from "@/components/business/BusinessEvidence.vue";
import { downloadWorkbook } from "@/api/business/exchange";
import type { CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import { useUserStore } from "@/stores/user";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";
import {
  queryDemands, readDemand, demandHistory, changeDemandStatus,
  type DemandDetail, type DemandHistory, type DemandRow,
} from "@/api/business/demands";

defineOptions({name:"DemandAdministration"});
const route=useRoute(),router=useRouter();
const userStore=useUserStore();
const canConfirm=computed(()=>userStore.userInfo.perms.includes("demand.activate"));
const canWrite=computed(()=>userStore.userInfo.perms.includes("write"));
const crudRef=ref<InstanceType<typeof CrudPage>>();
const exchangeOpen=ref(false),appliedQuery=ref("");
const batchTargets=ref<HandlingTarget[]|null>(null),exchangeIds=ref<string[]>([]);
let listRequest=0;
const detailVisible=ref(false),detailLoading=ref(false);
const detailError=ref(""),saving=ref(false);
const historyLoading=ref(false);
const activeTab=ref("locations");
const detail=ref<DemandDetail|null>(null),history=ref<DemandHistory|null>(null);
let detailSequence=0;
const statusColors={
  "待确认":"warning","已退回":"info","待承接":"success",
  "已承接":"primary","已解决":"success","已取消":"info",
} as const;
function statusColor(status:string){
  return statusColors[status as keyof typeof statusColors] || "info";
}
function quantityText(value:number){
  return formatScaledDecimal(value,4)||"—";
}
function lifecycleLabel(status:string){
  return ({pending:"待确认",active:"确认成立",returned:"已退回",cancelled:"已取消"} as Record<string,string>)[status]||"—";
}
function locationKindText(kind:string){
  const labels:Record<string,string>={physical_tower:"物理杆塔",logical_tower:"逻辑杆塔",span:"档距"};
  return labels[kind] || kind;
}
function workModeText(mode?:string){
  const labels:Record<string,string>={outage:"停电",non_outage:"不停电",unspecified:"未明确"};
  return labels[mode||"unspecified"] || mode || "";
}
const searchConfig:CrudSearchConfig={
  fields:[
    {type:"input",prop:"keywords",label:"专业需求",attrs:{
      placeholder:"需求编号 / 操作类型 / 问题描述",clearable:true,
    }},
    {type:"select",prop:"status",label:"需求状态",attrs:{clearable:true},options:Object.keys(statusColors)
      .map(status=>({label:status,value:status}))},
    historyScopeField("demands.show-deleted"),
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"demands",
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const request=++listRequest;
    const params=query as {
      pageNum?:number;pageSize?:number;keywords?:string;
      status?:string;
    };
    const page=await queryDemands({page:params.pageNum||1,
      pageSize:params.pageSize||20,keyword:params.keywords||"",status:params.status,...nativeListQuery(query, ["display_status"])});
    if(request===listRequest){
      const applied=new URLSearchParams({q:params.keywords||"",sort:"created_at",direction:"desc"});
      if(params.status)applied.set("filters",JSON.stringify({display_status:params.status}));
      applyNativeListQuery(applied, nativeListQuery(query, ["display_status"]));
      appliedQuery.value=applied.toString();
    }
    return {list:page.items,total:page.total};
  },
  toolbarActions:[
    {key:"create",label:"新增专业需求",permission:"write",onClick:()=>editDemand()},
    {key:"excel-import",label:"导入 Excel",permission:"write",onClick:({selectedKeys})=>{exchangeIds.value=selectedKeys.map(String);exchangeOpen.value=true;}},
    {key:"export-selection",label:"导出所选需求",permission:"read",disabled:({selectedKeys})=>!selectedKeys.length,onClick:({selectedKeys})=>exportReport(selectedKeys.map(String))},
    {key:"batch-confirm",label:"批量确认需求",permission:"demand.activate",disabled:({selectedRows})=>!selectedRows.length||selectedRows.length>100,onClick:({selectedRows})=>{batchTargets.value=selectedRows.map(row=>({id:String(row.id),expected_version:Number(row.current_version)}))}},
    {key:"excel-report",label:"导出 Excel",permission:"read",disabled:()=>!appliedQuery.value,onClick:()=>exportReport()},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {type:"selection",width:48,hideable:false},
    {prop:"demand_no",sortable:"custom",label:"需求编号",width:165,fixed:"left"},
    {prop:"display_status",sortable:"custom",...nativeColumnFilter("display_status", Object.keys(statusColors).map(value=>({value,text:value}))),label:"需求状态",cellType:"custom",width:115},
    {prop:"operation_snapshot",sortable:"custom",label:"操作类型",minWidth:180},
    {prop:"problem_description",sortable:"custom",label:"问题描述",cellType:"custom",minWidth:280},
    {prop:"line_count",sortable:"custom",label:"涉及线路数",minWidth:180},
    {prop:"location_count",sortable:"custom",label:"作业位置",width:110,align:"right"},
    {prop:"unit_snapshot",sortable:"custom",label:"计量单位",width:90},
    {prop:"current_version",sortable:"custom",label:"正式版本",width:105,align:"right"},
    {prop:"project_name",sortable:"custom",label:"关联项目",minWidth:175},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:180,
      actions:[
        {key:"detail",label:"查看详情",permission:"read",
          onClick:({row})=>row&&openDetail(String(row.id),Boolean(row.deleted))},
        {key:"confirm",label:"确认需求",permission:"demand.activate",
          visible:({row})=>row?.status==="pending"&&!row.binding&&!row.deleted,
          onClick:({row})=>row&&confirmRow(row as DemandRow)},
      ]},
  ],
};
async function exportReport(ids?:readonly string[]){
  const applied=new URLSearchParams(appliedQuery.value);
  applied.set("report","true");
  try{await downloadWorkbook("/demands/export?"+applied,undefined,ids)}
  catch(cause){ElMessage.error((cause as Error).message)}
}
async function openDetail(id:string,includeDeleted=false){
  const sequence=++detailSequence;
  detailVisible.value=true;detailLoading.value=true;
  detail.value=null;history.value=null;detailError.value="";activeTab.value="locations";
  try{
    const row=await readDemand(id,includeDeleted);
    if(sequence===detailSequence)detail.value=row;
  }
  catch(cause){if(sequence===detailSequence)detailError.value=(cause as Error).message}
  finally{if(sequence===detailSequence)detailLoading.value=false}
}
async function loadHistory(){
  if(!detail.value)return;
  historyLoading.value=true;
  try{history.value=await demandHistory(detail.value.id)}
  catch(cause){ElMessage.error((cause as Error).message)}
  finally{historyLoading.value=false}
}
function tabChanged(name:string|number){
  if(name==="history" && !history.value)void loadHistory();
}
async function confirmRow(row:DemandRow){
  if(saving.value)return;
  try{await ElMessageBox.confirm(
    `确认需求 ${row.demand_no} 成立并进入待承接状态？`,
    "确认专业需求",{type:"warning"});
  }catch{return}
  saving.value=true;
  try{
    await changeDemandStatus(row,"active");
    if(detail.value?.id===row.id)await openDetail(row.id);
    await crudRef.value?.refresh();
    ElMessage.success("专业需求已确认，正式状态已更新");
  }catch(cause){ElMessage.error((cause as Error).message)}
  finally{saving.value=false}
}
function confirmDetail(){if(detail.value)void confirmRow(detail.value)}
function editDemand(id?:string){
  detailVisible.value=false;
  return router.push({name:"DemandEditor",params:id?{demandId:id}:{},query:route.query});
}
function openProject(id:string){
  detailVisible.value=false;
  return router.push({name:"Projects",query:{project:id}});
}
function createProject(id:string) {
  return router.push({name: "Projects", query: {fromDemand: id}});
}
async function changeLifecycle(status:"returned"|"cancelled"){
  const row=detail.value;
  if(!row||saving.value)return;
  saving.value=true;
  try{
    const label=status==="returned"?"退回需求":"取消需求";
    const {value}=await ElMessageBox.prompt("填写办理依据",label,{
      type:"warning",inputValidator:value=>Boolean(value.trim())||"请填写办理依据",
    });
    await changeDemandStatus(row,status,value.trim());
    await openDetail(row.id);
    await crudRef.value?.refresh();
  }catch(cause){if(cause!=="cancel"&&cause!=="close")ElMessage.error((cause as Error).message)}
  finally{saving.value=false}
}
watch([()=>route.name,()=>route.query.demand],([name,id])=>{
  if(name==="Demands"&&typeof id==="string")void openDetail(id);
},{immediate:true});
</script>
