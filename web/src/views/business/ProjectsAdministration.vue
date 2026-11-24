<template>
  <el-alert v-if="sourceDemandId" class="mb-3" :title="sourceError || '从专业需求建立子项目'"
    :type="sourceError ? 'error' : 'info'" :closable="false">
    <el-button link type="primary" @click="returnToDemand">返回来源需求</el-button>
    <el-button v-if="sourceDemand" link type="primary" @click="crud?.openCreate()">编制承接项目</el-button>
  </el-alert>
  <CrudPage
    ref="crud"
    :search-config="searchConfig"
    :table-config="tableConfig"
    :form-config="formConfig"
    :load-form-data="loadForm"
    @saved="finishSourceCreate"
  >
    <template #table-cell-display_status="{row}">
      <el-tag :type="statusType(row.display_status)" effect="plain">{{ row.display_status }}</el-tag>
    </template>
    <template #table-cell-approval="{row}">
      {{ projectMoney(row.approval?.approved_budget_fen) }}
    </template>
    <template #table-cell-created_at="{ row }">{{ formatBeijingDateTime(row.created_at) }}</template>
    <template #table-cell-name="{row}">
      <el-link type="primary" :underline="false" @click="openProject(String(row.id),Boolean(row.deleted))">
        {{ row.name }}
      </el-link>
    </template>
    <template #form-project-agreement="{ formData }">
      <ProjectAgreementField :framework-id="formData.framework_id" v-model="formData.agreement_id" />
    </template>
    <template #form-source-demand>
      <el-descriptions v-if="sourceDemand" :column="1" border class="w-full">
        <el-descriptions-item label="需求编号">{{ sourceDemand.demand_no }}</el-descriptions-item>
        <el-descriptions-item label="问题描述">{{ sourceDemand.problem_description }}</el-descriptions-item>
        <el-descriptions-item label="承接规模">
          {{ sourceDemand.work_locations.filter(row => (row.remaining_quantity_scaled ?? row.quantity_scaled) > 0).length }}
          个剩余作业位置；剩余数量：{{ formatScaledDecimal(sourceDemand.remaining_quantity_scaled ?? sourceDemand.quantity_scaled, 4) }}
          {{ sourceDemand.unit_snapshot }}
        </el-descriptions-item>
      </el-descriptions>
    </template>
  </CrudPage>

  <el-drawer
    v-model="detailsVisible" :title="detail ? detail.name : '子项目详情'"
    size="min(95vw, 1050px)" append-to-body
  >
    <el-skeleton v-if="loadingDetail" animated :rows="9"/>
    <el-alert v-else-if="detailError" type="error" :title="detailError" :closable="false"/>
    <template v-else-if="detail">
      <el-descriptions :data-guide-record="`project/${detail.id}`" border :column="2" class="mb-4">
        <el-descriptions-item label="项目编号">{{ detail.code }}</el-descriptions-item>
        <el-descriptions-item label="项目状态">
          <el-tag :type="statusType(detail.display_status)">{{ detail.display_status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="所属年度框架">
          {{ frameworkNames[detail.framework_id] || detail.framework_id }}
        </el-descriptions-item>
        <el-descriptions-item label="执行协议">
          {{ agreementLabel(detail.funding?.agreement_id) }}
        </el-descriptions-item>
        <el-descriptions-item label="档案版本">V{{ detail.profile_version }}</el-descriptions-item>
        <el-descriptions-item label="正式批准预算">
          {{ projectMoney(detail.approval?.approved_budget_fen) }}
        </el-descriptions-item>
        <el-descriptions-item label="归口单位">{{ detail.managing_unit_name || "—" }}</el-descriptions-item>
        <el-descriptions-item label="项目负责人">{{ detail.owner_username || "—" }}</el-descriptions-item>
      </el-descriptions>
      <div class="page-heading-actions mb-4 flex flex-wrap justify-end gap-2">
        <el-button v-if="fundingSource" @click="returnToFunding">返回资金归属</el-button>
        <el-button  :data-guide-action="detail.approval && !draftApproval ? 'projects.change' : 'projects.approval-navigation'" v-if="compileAction" type="primary" :disabled="!compileAction.enabled"
          :title="compileAction.reason" @click="openApproval(draftApproval ? 'review' : 'compile')">
          {{ compileAction.label }}
        </el-button>
        <el-button data-guide-action="projects.approve" v-if="draftApproval && canReview" type="primary" @click="openApproval('review')">审核批准草稿</el-button>
        <el-button data-guide-action="projects.close" v-if="!detail.deleted && detail.status === 'approved' && canClose" @click="closeOpen = true">审核结项</el-button>
        <el-button data-guide-action="projects.finance" v-if="!detail.deleted && (detail.status === 'approved' || detail.status === 'closed')" @click="openFinance">费用与结算</el-button>
      </div>
      <el-tabs v-model="detailTab">
        <el-tab-pane :label="`承接需求（${linkedScopes.length}）`" name="scopes">
          <div class="mb-3 flex justify-end gap-2">
            <el-button data-guide-action="projects.link" v-if="canWrite && linkAction?.enabled"
              type="primary" @click="openDemandChooser">
              关联需求
            </el-button>
            <el-button data-guide-action="projects.stock" v-if="!detail.deleted && canStock && detail.status==='reserve'"
              type="success" @click="confirmStock">
              确认入库
            </el-button>
          </div>
          <el-table :data="linkedScopes" border row-key="id" min-height="160">
            <el-table-column prop="demand_no" label="需求编号" min-width="140" fixed="left"/>
            <el-table-column prop="problem_description" label="问题描述" min-width="200"/>
            <el-table-column prop="operation_snapshot" label="操作类型" min-width="150"/>
            <el-table-column prop="line_count" label="涉及线路数" min-width="155"/>
            <el-table-column prop="location_count" label="位置数" width="90"/>
            <el-table-column prop="demand_display_status" label="需求状态" width="105"/>
          </el-table>
          <el-empty v-if="!linkedScopes.length" description="尚未关联完整专业需求"/>
        </el-tab-pane>
        <el-tab-pane label="立项与正式版本" name="approvals">
          <el-alert v-if="detail.status==='reserve'" title="储备项目应先关联需求并入库后才能编制立项"
            type="info" :closable="false"/>
          <div class="mb-3 flex justify-end">
            <el-button :loading="historyLoading" @click="loadApprovalHistory">查看全部批准版本</el-button>
          </div>
          <el-table :data="approvalHistoryRows" border row-key="id">
            <el-table-column prop="version_no" label="批准版本" width="110"/>
            <el-table-column label="办理状态" width="120">
              <template #default="{ row }">{{ approvalStatus(row.status) }}</template>
            </el-table-column>
            <el-table-column label="批准预算" min-width="160">
              <template #default="{row}">{{ projectMoney(row.approved_budget_fen) }}</template>
            </el-table-column>
            <el-table-column label="批准时间" min-width="170">
              <template #default="{ row }">{{ formatBeijingDateTime(row.approved_at) }}</template>
            </el-table-column>
            <el-table-column prop="positionCount" label="位置数" width="95"/>
          </el-table>
          <el-empty v-if="!detail.approvals?.length" description="暂无正式立项版本"/>
        </el-tab-pane>
        <el-tab-pane label="正式业务追溯" name="history" lazy>
          <div data-guide-action="projects.history"><BusinessHistoryViewer v-if="projectHistoryTarget" :target="projectHistoryTarget" /></div>
        </el-tab-pane>
      </el-tabs>
    </template>
    <template #footer>
      <el-button data-guide-action="projects.refresh-detail" :loading="refreshingDetail" :disabled="loadingDetail || !detail" @click="reloadDetail">刷新详情</el-button>
      <el-button @click="detailsVisible=false">关闭详情</el-button>
    </template>
  </el-drawer>

  <ProjectCloseReview v-if="closeOpen && detail" :project-id="detail.id"
    @close="closeOpen = false" @completed="closedProject" />

  <el-dialog v-model="demandDialogVisible" title="关联完整专业需求" width="min(95vw, 980px)"
    append-to-body destroy-on-close>
    <el-alert title="一次只能由一个项目承接完整需求，不能在本表中拆分位置或数量。"
      type="info" :closable="false" class="mb-3"/>
    <div class="mb-3 flex gap-2">
      <el-input v-model="demandQuery" clearable placeholder="按需求编号或问题描述搜索"
        @keyup.enter="loadCandidates(true)"/>
      <el-button :loading="demandLoading" @click="loadCandidates(true)">查询</el-button>
    </div>
    <el-table ref="candidateTable" v-loading="demandLoading" :data="eligibleDemands" border row-key="id" max-height="460"
      @selection-change="selectionChanged">
      <el-table-column type="selection" width="55" reserve-selection :selectable="(row:DemandRow)=>!row.binding"/>
      <el-table-column prop="demand_no" label="需求编号" width="145" fixed="left"/>
      <el-table-column prop="problem_description" label="问题描述" min-width="180"/>
      <el-table-column prop="operation_snapshot" label="操作类型" min-width="140"/>
      <el-table-column prop="line_count" label="涉及线路数" min-width="150"/>
      <el-table-column prop="location_count" label="点位数" width="85"/>
      <el-table-column label="关联状态" width="118">
        <template #default="{row}">{{ row.binding ? "已承接" : "可承接" }}</template>
      </el-table-column>
    </el-table>
    <el-pagination class="mt-3" v-model:current-page="candidatePage" :page-size="20" :total="candidateTotal" layout="total, prev, pager, next" @current-change="loadCandidates(false)" />
    <template #footer>
      <el-button @click="demandDialogVisible=false">取消</el-button>
      <el-button data-guide-action="demands.link-submit" type="primary" :loading="linking" :disabled="!selected.length" @click="commitLinks">
        关联已选完整需求（{{ selected.length }}）
      </el-button>
    </template>
  </el-dialog>
  <HandlingBatchDialog v-if="batchTargets" kind="projects" :targets="batchTargets" @close="batchTargets=null" @changed="crud?.refresh(true)" />
</template>

<script setup lang="ts">
import HandlingBatchDialog from "@/components/business/HandlingBatchDialog.vue";
import { downloadWorkbook } from "@/api/business/exchange";
import type { HandlingTarget } from "@/api/business/handling-batch";
import { historyScopeField, nativeListQuery, nativeColumnFilter, projectStatusChoices } from "@/utils/business/native-list-query";
import {computed,nextTick,reactive,ref,onMounted,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import { ElMessage,ElMessageBox, type TableInstance } from "element-plus";
import CrudPage from "@/components/Crud/CrudPage.vue";
import ProjectCloseReview from "@/components/business/ProjectCloseReview.vue";
import ProjectAgreementField from "@/components/business/ProjectAgreementField.vue";
import BusinessHistoryViewer from "@/components/business/BusinessHistoryViewer.vue";
import type { HistoryTarget } from "../../../../server/shared/types/history";
import type {CrudSearchConfig,CrudTableConfig,CrudFormConfig,CrudRecord} from "@/components/Crud/types";
import type {OptionItem} from "@/api/common";
import {useUserStore} from "@/stores/user";
import {listFunding,fenToYuan} from "@/api/business/funding";
import {queryDemandCandidates,readDemand,type DemandDetail,type DemandRow} from "@/api/business/demands";
import { listDictionaries } from "@/api/business/dictionaries";
import { organizationTree } from "@/api/business/organizations";
import {
  listProjects,projectDetail,saveProject,createProjectFromDemand,stockProject,linkProjectDemands,
  projectMoney,projectActions,projectApprovalHistory,
  type ProjectApproval,type ProjectAction,type ProjectDetail,type ProjectForm,
} from "@/api/business/projects";
import {formatBeijingDateTime} from "@/utils/business/datetime";
import {formatScaledDecimal} from "@/utils/business/fixed-scale";

defineOptions({name:"ProjectsAdministration"});
const route=useRoute();
const router=useRouter();
const fundingSource=computed(()=>route.query.sourceFunding==="frameworks" || route.query.sourceFunding==="agreements"
  ? route.query.sourceFunding : undefined);
function returnToFunding() {
  if(!fundingSource.value)return;
  const name=fundingSource.value==="frameworks"?"Frameworks":"Agreements";
  const previous=router.options.history.state.back;
  if(typeof previous === "string" && previous.split("?")[0]==="/funding/"+fundingSource.value)router.back();
  else void router.push({name,query:{funding:route.query.funding}});
}
const userStore=useUserStore();
const canWrite=computed(()=>userStore.userInfo.perms.includes("write"));
const canStock=computed(()=>userStore.userInfo.perms.includes("project.stock"));
const canClose=computed(()=>userStore.userInfo.perms.includes("project.close"));
const crud=ref<InstanceType<typeof CrudPage>>();
const batchTargets=ref<HandlingTarget[]|null>(null);
const frameworkChoices=ref<OptionItem[]>([]);
const categoryChoices=ref<OptionItem[]>([]), organizationChoices=ref<OptionItem[]>([]);
const actorChoices=ref<OptionItem[]>([]);
const sourceDemandId=computed(()=>route.name === "Projects" && typeof route.query.fromDemand === "string"
  ? route.query.fromDemand : undefined);
const sourceDemand=ref<DemandDetail>();
const sourceError=ref("");
let createdFromDemand:string|undefined;
function returnToDemand(){
  return router.push({name:"Demands",query:{demand:sourceDemandId.value}});
}
function finishSourceCreate(){
  if (!createdFromDemand) return;
  const project = createdFromDemand;
  createdFromDemand = undefined;
  void router.replace({name:"Projects",query:{project}});
}
const frameworkNames=reactive<Record<string,string>>({});
const agreementNames=reactive<Record<string,string>>({});
const detailsVisible=ref(false),loadingDetail=ref(false),detailError=ref("");
const refreshingDetail=ref(false);
const detail=ref<ProjectDetail|null>(null),detailTab=ref("scopes");
const projectHistoryTarget = computed<HistoryTarget | undefined>(() =>
  detail.value ? { kind: "projects", id: detail.value.id } : undefined);
const actions=ref<ProjectAction[]>([]);
const closeOpen=ref(false);
const approvalHistory=ref<ProjectApproval[]>();
const historyLoading=ref(false);
const approvalHistoryRows=computed(()=>(approvalHistory.value??detail.value?.approvals??[]).map(approval=>({
  ...approval,
  positionCount:[...approval.scopes,...approval.pending_scopes].reduce((total,scope)=>total+scope.locations.length,0),
})));
const demandDialogVisible=ref(false),demandLoading=ref(false),linking=ref(false);
const eligibleDemands=ref<DemandRow[]>([]),selected=ref<DemandRow[]>([]);
const demandQuery=ref("");
const candidatePage=ref(1),candidateTotal=ref(0),candidateTable=ref<TableInstance>();
let appliedDemandKeyword="",candidateSequence=0;
const linkedScopes=computed(()=>detail.value?.scopes.filter(x=>Boolean(x.binding))||[]);
const compileAction=computed(()=>actions.value.find(action=>action.key==="approval"));
const linkAction=computed(()=>actions.value.find(action=>action.key==="link"));
const draftApproval=computed(()=>detail.value?.approvals.find(row=>row.status==="draft"));
const canReview=computed(()=>Boolean(!detail.value?.deleted && draftApproval.value &&
  userStore.userInfo.perms.includes(detail.value?.approval ? "change.approve" : "project.approve")));
let detailSequence=0;
function statusType(status:string){
  return status==="已批准"||status==="在办"?"success":status==="已结项"?"info":"warning";
}
function agreementLabel(id:string|null|undefined){
  return id?(agreementNames[id]||id):"直接归属年度框架（无执行协议）";
}
async function openProject(id:string,includeDeleted=false) {
  const sequence=++detailSequence;
  detailsVisible.value=true;loadingDetail.value=true;detail.value=null;detailError.value="";
  detailTab.value="scopes";actions.value=[];approvalHistory.value=undefined;historyLoading.value=false;
  try {
    const [project, nextActions]=await Promise.all([projectDetail(id,includeDeleted),includeDeleted?Promise.resolve([]):projectActions(id)]);
    if(sequence!==detailSequence)return;
    detail.value=project;
    actions.value=nextActions;
  } catch(e) {
    if(sequence===detailSequence)detailError.value=(e as Error).message;
  } finally {
    if(sequence===detailSequence)loadingDetail.value=false;
  }
}
async function refreshProject(){
  const id=detail.value?.id;
  const sequence=detailSequence;
  if(id){
    const [project,nextActions]=await Promise.all([projectDetail(id,Boolean(detail.value?.deleted)),detail.value?.deleted?Promise.resolve([]):projectActions(id)]);
    if(sequence===detailSequence){
      detail.value=project;actions.value=nextActions;approvalHistory.value=undefined;
    }
  }
  await crud.value?.refresh();
}
async function reloadDetail(){
  if(refreshingDetail.value||!detail.value)return;
  refreshingDetail.value=true;
  try{await refreshProject()}
  catch(cause){ElMessage.error((cause as Error).message)}
  finally{refreshingDetail.value=false}
}
function approvalStatus(status:ProjectApproval["status"]){
  return {draft:"待审核",approved:"已批准",withdrawn:"已撤回"}[status];
}
async function loadApprovalHistory(){
  if(!detail.value||historyLoading.value)return;
  const sequence=detailSequence;
  historyLoading.value=true;
  try{
    const history=await projectApprovalHistory(detail.value.id);
    if(sequence===detailSequence)approvalHistory.value=history;
  }catch(cause){
    if(sequence===detailSequence)ElMessage.error((cause as Error).message);
  }finally{
    if(sequence===detailSequence)historyLoading.value=false;
  }
}
function openApproval(task:"compile"|"review"){
  if(!detail.value)return;
  detailsVisible.value=false;
  return router.push({name:"ProjectApproval",params:{projectId:detail.value.id,task},query:route.query});
}
function openFinance(){
  if(!detail.value)return;
  detailsVisible.value=false;
  return router.push({name:"Finance",query:{project:detail.value.id}});
}
async function closedProject(){
  closeOpen.value=false;
  try{await refreshProject()}
  catch(cause){ElMessage.error((cause as Error).message)}
}
async function loadCandidates(reset=false){
  if(reset){
    candidatePage.value=1; appliedDemandKeyword=demandQuery.value;
    candidateTable.value?.clearSelection();selected.value=[];
  }
  const sequence=++candidateSequence;
  demandLoading.value=true;
  try{
    const p=await queryDemandCandidates({page:candidatePage.value,pageSize:20,
      keyword:appliedDemandKeyword,includePending:true});
    if(sequence!==candidateSequence)return;
    eligibleDemands.value=p.items;candidateTotal.value=p.total;
  }catch(e){if(sequence===candidateSequence)ElMessage.error((e as Error).message)}
  finally{if(sequence===candidateSequence)demandLoading.value=false}
}
function selectionChanged(rows:DemandRow[]){selected.value=rows}
function openDemandChooser(){
  demandDialogVisible.value=true;demandQuery.value="";
  void loadCandidates(true);
}
async function commitLinks(){
  if(!detail.value||!selected.value.length)return;
  linking.value=true;
  try{
    await linkProjectDemands(detail.value.id,selected.value);
    demandDialogVisible.value=false;
    ElMessage.success("完整需求关联成功");
    await refreshProject();
  }catch(e){ElMessage.error((e as Error).message)}
  finally{linking.value=false}
}
async function confirmStock(){
  if(!detail.value)return;
  try{
    await ElMessageBox.confirm(
      "确认将当前子项目正式入库？入库后年度框架不可直接变更。",
      "确认入库",{type:"warning"});
    detail.value=await stockProject(detail.value);
    ElMessage.success("项目已正式入库");
    await refreshProject();
  }catch(e){if(e!=="cancel")ElMessage.error((e as Error).message)}
}
const searchConfig:CrudSearchConfig={
  fields:[{type:"input",prop:"keywords",label:"子项目",attrs:{
    clearable:true,placeholder:"项目编号 / 项目名称"}},
    {type:"select",prop:"status",label:"项目状态",attrs:{clearable:true},options:projectStatusChoices.map(x=>({label:x.text,value:x.value}))},
    historyScopeField("projects.show-deleted"),
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"projects",
  table:{border:true},rowKey:"id",
  fetchData:async(query)=>{
    const p=query as {pageNum?:number;pageSize?:number;keywords?:string;status?:string};
    const result=await listProjects({
      page:p.pageNum||1,size:p.pageSize||20,keyword:p.keywords||"",status:p.status,...nativeListQuery(query, ["display_status"]),
    });
    return {list:result.items,total:result.total};
  },
  toolbarActions:[{key:"create",label:"新增子项目",permission:"write"},
    {key:"export-selection",label:"导出所选项目",permission:"read",disabled:({selectedKeys})=>!selectedKeys.length,
      onClick:async({selectedKeys})=>{try{await downloadWorkbook("/projects/export",undefined,selectedKeys.map(String))}catch(e){ElMessage.error((e as Error).message)}}},
    {key:"batch-stock",label:"批量入库",permission:"project.stock",disabled:({selectedRows})=>!selectedRows.length||selectedRows.length>100,
      onClick:({selectedRows})=>{batchTargets.value=selectedRows.map(row=>({id:String(row.id),expected_version:Number(row.version)}))}},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {type:"selection",width:48,hideable:false},
    {prop:"code",sortable:"custom",label:"项目编号",minWidth:140,fixed:"left"},
    {prop:"name",sortable:"custom",label:"项目名称",cellType:"custom",minWidth:190},
    {prop:"display_status",sortable:"custom",...nativeColumnFilter("display_status",projectStatusChoices),label:"项目状态",cellType:"custom",width:105},
    {prop:"category_name",sortable:"custom",label:"项目类别",minWidth:140},
    {prop:"approval",label:"批准预算",cellType:"custom",width:135},
    {prop:"created_at",sortable:"custom",label:"创建时间",cellType:"custom",minWidth:175},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:210,actions:[
      {key:"detail",label:"查看详情",permission:"read",
        onClick:({row})=>row&&openProject(String(row.id),Boolean(row.deleted))},
      {key:"edit",label:"修改档案",permission:"write",
        visible:({row})=>row?.status!=="closed"},
    ]},
  ],
};
const formConfig:CrudFormConfig<ProjectForm>={
  title:({mode})=>mode==="create"?(sourceDemandId.value?"创建子项目并承接":"新增子项目")
    :mode==="view"?"查看子项目":"修改项目档案",
  rowKey:"id",dialog:{width:700},
  fields:[
    {type:"input-number",prop:"profile_version",label:"档案版本",hidden:true},
    {type:"input-number",prop:"expected_funding_version",label:"资金版本",hidden:true},
    {type:"input",prop:"status",label:"正式状态",hidden:true},
    {type:"custom",prop:"source_demand",slotName:"source-demand",label:"承接来源",
      visible:({mode})=>mode==="create" && Boolean(sourceDemand.value)},
    {type:"input",prop:"name",label:"项目名称",required:true},
    {type:"select",prop:"framework_id",label:"年度框架",required:true,
      options:frameworkChoices,attrs:{filterable:true},
      tips:"可直接归属年度框架，执行协议不是必填",
      readonly:({mode,model})=>mode!=="create"&&model.status!=="reserve"},
    {type:"custom",prop:"agreement_id",slotName:"project-agreement",label:"执行协议"},
    {type:"select",prop:"category_id",label:"项目分类",options:categoryChoices,attrs:{filterable:true,clearable:true}},
    {type:"select",prop:"managing_unit_id",label:"归口单位",options:organizationChoices,attrs:{filterable:true,clearable:true}},
    {type:"select",prop:"owner_id",label:"项目负责人",options:actorChoices,attrs:{filterable:true,clearable:true}},
    {type:"select",prop:"manager_id",label:"管理人员",options:actorChoices,attrs:{filterable:true,clearable:true}},
    {type:"date-picker",prop:"planned_start_on",label:"计划开始",attrs:{valueFormat:"YYYY-MM-DD"}},
    {type:"date-picker",prop:"planned_end_on",label:"计划结束",attrs:{valueFormat:"YYYY-MM-DD"}},
    {type:"input",prop:"preliminary_estimate_yuan",label:"初步估算（元）",
      attrs:{placeholder:"可选，最多两位小数"}},
    {type:"input",prop:"preliminary_estimate_basis",label:"估算依据"},
    {type:"input",prop:"reason",label:"修订说明"},
  ],
  async submitForm(form,{mode,id}){
    if(mode==="view")return;
    if (mode === "create" && sourceDemandId.value) {
      if (!sourceDemand.value) throw Error(sourceError.value || "正在读取来源需求");
      createdFromDemand = (await createProjectFromDemand(form,sourceDemand.value)).id;
    } else await saveProject(form,id===undefined?undefined:String(id));
  },
};
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  const data=await projectDetail(String(row.id));
  for (const [options, id, name] of [
    [categoryChoices, data.category_id, data.category_name], [organizationChoices, data.managing_unit_id, data.managing_unit_name],
    [actorChoices, data.owner_id, data.owner_username], [actorChoices, data.manager_id, data.manager_username],
  ] as const) {
    if (id && !options.value.some(option=>option.value===id)) options.value.push({value:id,label:name||id});
  }
  return {...data,framework_id:data.framework_id,
    agreement_id:data.funding?.agreement_id??null,
    preliminary_estimate_yuan:data.preliminary_estimate_fen==null
      ?"":fenToYuan(data.preliminary_estimate_fen),
    expected_funding_version:data.funding?.version_no||0,
  };
}
onMounted(async()=>{
  try{
    const [fw, agreements, categories, orgRows, actors] = await Promise.all([
      listFunding("frameworks",{size:500}), listFunding("agreements",{size:500}),
      listDictionaries("categories",{size:500}), organizationTree(), fetch("/api/actors"),
    ]);
    if (!actors.ok) throw Error("人员选项读取失败");
    const actorRows=await actors.json() as Array<{id:string;username:string}>;
    categoryChoices.value=categories.items.filter(row=>row.status==="active").map(row=>({value:row.id,label:row.name}));
    organizationChoices.value=orgRows.filter(row=>row.status==="active"&&!row.deleted).map(row=>({value:row.id,label:row.name}));
    actorChoices.value=actorRows.map(row=>({value:row.id,label:row.username}));
    frameworkChoices.value=fw.items.filter(row=>row.status==="active")
      .map(row=>({label:row.name,value:row.id}));
    for(const row of fw.items)frameworkNames[row.id]=row.name;
    for(const row of agreements.items)agreementNames[row.id]=row.name;
  }catch(e){ElMessage.error((e as Error).message)}
});
watch(sourceDemandId, async (id, _old, onCleanup) => {
  sourceDemand.value = undefined;
  sourceError.value = "";
  if (!id) return;
  let current = true;
  onCleanup(() => { current = false; });
  try {
    if (!canWrite.value) throw Error("当前账号没有创建子项目的权限");
    const demand = await readDemand(id);
    if (!current) return;
    if (demand.deleted || demand.status !== "active" || demand.binding ||
      (demand.remaining_quantity_scaled ?? demand.quantity_scaled) <= 0)
      throw Error("只有已确认、尚未承接且有剩余工作量的需求可建立子项目");
    sourceDemand.value = demand;
    await nextTick();
    if (current) crud.value?.openCreate();
  } catch (cause) {
    if (current) sourceError.value = (cause as Error).message;
  }
}, { immediate: true });
watch([()=>route.name,()=>route.query.project],([name,id])=>{
  if(name==="Projects"&&typeof id==="string")void openProject(id);
},{immediate:true});
</script>
