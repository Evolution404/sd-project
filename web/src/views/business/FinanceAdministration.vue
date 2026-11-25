<template>
  <div class="page-container">
  <el-card v-if="projectContext" class="shrink-0" shadow="never">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">{{ projectContext.name }}<span class="ml-3">费用与结算</span></h2>
      <div class="page-heading-actions flex gap-2">
        <el-button v-if="origin.source === 'finance-projects'" @click="backToFinanceProjects">返回项目财务列表</el-button>
        <el-button @click="router.push({ name: 'Projects', query: { project: projectContext.id } })">返回子项目</el-button>
      </div>
    </div>
    <el-tabs v-model="contextTab" class="mt-3">
      <el-tab-pane name="settlements"><template #label><span data-guide-action="finance.settlement-section">结算单</span></template></el-tab-pane>
      <el-tab-pane label="费用科目、费用及核对" name="costs" />
    </el-tabs>
  </el-card>
  <el-card v-else-if="!projectId" data-guide-action="finance.cross" shadow="never" class="mb-3 shrink-0">
    <el-tabs :model-value="portfolioView" @update:model-value="changePortfolioView">
      <el-tab-pane name="projects"><template #label><span data-guide-action="finance.project-mode">按项目办理</span></template></el-tab-pane>
      <el-tab-pane label="结算单" name="settlements" />
      <el-tab-pane label="实际费用" name="costs" />
      <el-tab-pane label="费用核对" name="reconciliations" />
    </el-tabs>
  </el-card>
  <el-alert v-if="contextError" type="error" :title="contextError" :closable="false" class="mb-3" />
  <ProjectFinanceWorkspace v-if="projectContext && contextTab === 'costs'" :key="projectContext.id"
    :project-id="projectContext.id" :initial-tab="workspaceTab"
    :closed="projectContext.status === 'closed' || Boolean(projectContext.deleted)" />
  <CrudPage v-else-if="!projectId && portfolioView === 'projects'" embedded
    :search-config="projectSearch" :table-config="projectTable">
    <template #table-cell-name="{ row }">
      <router-link :to="projectFinanceRoute(row)" custom v-slot="{ href, navigate }">
        <el-link type="primary" :href="href" @click="navigate">{{ row.name }}</el-link>
      </router-link>
    </template>
    <template #table-cell-display_status="{ row }">
      <el-tag :type="row.deleted ? 'danger' : 'info'" effect="plain">{{ row.deleted ? "已删除" : row.display_status }}</el-tag>
    </template>
    <template #table-cell-approval="{ row }">
      {{ row.approval ? projectMoney(row.approval.approved_budget_fen) : "尚未批准" }}
    </template>
  </CrudPage>
  <PortfolioFinance v-else-if="!projectId && (portfolioView === 'costs' || portfolioView === 'reconciliations')" :kind="portfolioView" />
  <CrudPage embedded v-else ref="crud" :search-config="searchConfig" :table-config="tableConfig">
    <template #table-cell-project_name="{row}">
      <el-link type="primary" @click="router.push({ name: 'Projects', query: { project: row.project_id } })">{{ row.project_name || projectContext?.name || "历史项目" }}</el-link>
    </template>
    <template #table-cell-amount="{row}">
      {{ projectMoney(row.draft?.document.amount_fen ?? row.version?.amount_fen ?? null) }}
    </template>
    <template #table-cell-status="{row}">
      <el-tag :type="statusType(row.status)" effect="plain">{{ settlementStatusText(row.status) }}</el-tag>
    </template>
    <template #table-cell-effective_amount_fen="{ row }">{{ projectMoney(row.effective_amount_fen) }}</template>
    <template #table-cell-created_at="{ row }">{{ formatBeijingDateTime(row.created_at) }}</template>
  </CrudPage>
  <BusinessExchangeDialog v-if="exchangeOpen && projectId" kind="settlements" :project-id="projectId"
    :applied-query="settlementQuery" @close="exchangeOpen = false" @changed="crud?.refresh()" />

  <el-dialog v-model="chooseProject" title="选择已有正式立项的子项目" width="min(95vw, 950px)"
    append-to-body>
    <el-alert class="mb-3" :closable="false" type="info"
      title="结算单必须归属一个已批准项目；选择完整项目，不直接修改正式立项版本。"/>
    <el-space class="mb-3" wrap>
      <el-input v-model="projectKeyword" clearable placeholder="项目编号 / 名称" @keyup.enter="loadProjects(true)" />
      <el-button :loading="projectLoading" @click="loadProjects(true)">搜索</el-button>
    </el-space>
    <el-table v-loading="projectLoading" :data="approvedProjects" border max-height="410" row-key="id">
      <el-table-column prop="code" label="项目编号" width="160"/>
      <el-table-column prop="name" label="项目名称" min-width="230"/>
      <el-table-column prop="display_status" label="办理状态" width="130"/>
      <el-table-column label="正式预算" min-width="140">
        <template #default="{row}">{{ projectMoney(row.approval?.approved_budget_fen) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{row}">
          <el-button size="small" type="primary" data-guide-action="finance.project-mode" @click="selectProject(row.id)">选择项目</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="mt-3" v-model:current-page="projectPage" :page-size="20" :total="projectTotal" layout="total, prev, pager, next" @current-change="loadProjects(false)" />
    <template #footer>
      <el-button @click="chooseProject=false">取消</el-button>
      <el-button :loading="projectLoading" @click="loadProjects(false)">刷新</el-button>
    </template>
  </el-dialog>


  <el-drawer v-model="detailsOpen" :title="reconciling ? '结算逐笔对账' : '结算正式事实及草稿'" size="min(95vw, 950px)" append-to-body destroy-on-close>
    <el-skeleton v-if="detailsLoading" animated :rows="7" />
    <el-alert v-else-if="detailError" type="error" :title="detailError" :closable="false" />
    <section v-else-if="detail && reconciling" class="flex h-full min-h-0 flex-col gap-3" aria-label="结算逐笔对账">
      <el-descriptions :column="2" border class="shrink-0">
        <el-descriptions-item label="结算编号">{{ detail.number }}</el-descriptions-item>
        <el-descriptions-item label="结算方式">按子费用</el-descriptions-item>
      </el-descriptions>
      <div class="flex shrink-0 justify-end"><el-button @click="reconciling = false">返回结算详情</el-button></div>
      <ProjectFinanceWorkspace :key="detail.id" :project-id="detail.project_id" :settlement-id="detail.id"
        :closed="Boolean(detail.write_blocked_reason)" />
    </section>
    <template v-else-if="detail">
      <SettlementFacts :detail="detail" />
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <el-button v-if="!detail.deleted && detail.effective_mode === 'itemized'" data-guide-action="finance.reconciliation-section" @click="reconciling = true">逐笔对账</el-button>
      </div>
      <div v-if="!detail.deleted && !detail.write_blocked_reason" class="mt-4 flex flex-wrap justify-end gap-2">
        <el-button v-if="canWrite && detail.draft" data-guide-action="finance.edit-draft" @click="openWork('SettlementEdit', detail.id)">编辑草稿</el-button>
        <template v-if="canWrite && !detail.draft && ['approve', 'return', 'reject'].includes(detail.status)">
          <el-button @click="openWork('SettlementEdit', detail.id)">编制修订</el-button>
          <el-button v-if="detail.status === 'approve'" data-guide-action="finance.void" @click="openWork('SettlementVoid', detail.id)">编制作废</el-button>
        </template>
        <el-button v-if="(canWrite && (detail.draft || detail.status === 'return')) || (canReview && detail.status === 'submit')"
          type="primary" @click="openWork('SettlementReview', detail.id)">进入结算审核办理</el-button>
      </div>
    </template>
  </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter, applyNativeListQuery, projectStatusChoices } from "@/utils/business/native-list-query";
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { usePageOverlays } from "@/composables/usePageOverlays";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type { CrudRecord, CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import { LIST_QUERY_KEY } from "@/components/Crud/utils/list-state";
import ProjectFinanceWorkspace from "@/components/business/ProjectFinanceWorkspace.vue";
import PortfolioFinance from "@/components/business/PortfolioFinance.vue";
import SettlementFacts from "@/components/business/SettlementFacts.vue";
import BusinessExchangeDialog from "@/components/business/BusinessExchangeDialog.vue";
import { listProjects, projectDetail, projectMoney, type ProjectRow, type ProjectDetail } from "@/api/business/projects";
import { listSettlements, settlementDetail, type SettlementDetails } from "@/api/business/finance";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { settlementStatusText } from "@/utils/business/settlement-status";
import { useUserStore } from "@/stores/user";

const route = useRoute();
const router = useRouter();
const origin = { ...route.query };
const projectId = typeof origin.project === "string" ? origin.project : undefined;
const workspaceTab = origin.work === "reconciliations" ? "reconciliations" : "costs";
const contextTab = ref(origin.work ? "costs" : "settlements");
const portfolioView = origin.view === "costs" || origin.view === "reconciliations" || origin.view === "settlements"
  ? origin.view : "projects";
const projectContext = ref<ProjectDetail>();
const exchangeOpen = ref(false), settlementQuery = ref("");
const contextError = ref("");
const userStore = useUserStore();
const canWrite = computed(() => userStore.userInfo.perms.includes("write"));
const canReview = computed(() => userStore.userInfo.perms.includes("settlement.approve"));
const crud = ref<InstanceType<typeof CrudPage>>();
const chooseProject = ref(false), projectLoading = ref(false);
const projectKeyword = ref("");
const projectPage = ref(1), projectTotal = ref(0);
let appliedProjectKeyword = "", projectSequence = 0;
const approvedProjects = ref<ProjectRow[]>([]);
const detailsOpen = ref(false), detailsLoading = ref(false), detailError = ref("");
const reconciling = ref(false);
const detail = ref<SettlementDetails>();
let detailSequence = 0;
let scrollTop = 0;
let deactivated = false;
usePageOverlays([chooseProject,detailsOpen,exchangeOpen],{invalidate:()=>{
  detailSequence++;projectSequence++;
  detailsLoading.value=false;projectLoading.value=false;
  detail.value=undefined;approvedProjects.value=[];projectTotal.value=0;
}});

function changePortfolioView(view: string | number) {
  void router.push({ name: "Finance", query: { view: view === "projects" ? undefined : String(view) } });
}

function projectFinanceRoute(project: ProjectRow) {
  return { name: "Finance", query: {
    project: project.id,
    archive: project.deleted ? "true" : undefined,
    source: "finance-projects",
    sourceList: route.query[LIST_QUERY_KEY],
  } };
}

function backToFinanceProjects() {
  void router.push({ name: "Finance", query: { [LIST_QUERY_KEY]: origin.sourceList } });
}

function statusType(status: string) {
  return status === "approve" ? "success" : status === "draft" ? "info" : status === "return" ? "warning" : "primary";
}

function navigate(name: string, params: Record<string, string>) {
  scrollTop = document.querySelector(".layout-content")?.scrollTop ?? 0;
  detailsOpen.value = false;
  chooseProject.value = false;
  return router.push({ name, params, query: { ...route.query } });
}

function openWork(name: "SettlementEdit" | "SettlementVoid" | "SettlementReview", settlementId: string) {
  return navigate(name, { settlementId });
}

function selectProject(id: string) {
  return navigate("SettlementCreate", { projectId: id });
}

async function showDetails(id: string) {
  const sequence = ++detailSequence;
  reconciling.value = false;
  detailsOpen.value = true;
  detailsLoading.value = true;
  detail.value = undefined;
  detailError.value = "";
  try {
    const row = await settlementDetail(id);
    if (sequence === detailSequence) detail.value = row;
  } catch (cause) {
    if (sequence === detailSequence) detailError.value = (cause as Error).message;
  } finally {
    if (sequence === detailSequence) detailsLoading.value = false;
  }
}

onDeactivated(() => { deactivated = true; });
onActivated(async () => {
  if (!deactivated) return;
  await crud.value?.refresh();
  await nextTick();
  document.querySelector(".layout-content")?.scrollTo(0, scrollTop);
});
async function loadProjects(reset = false){
  if (reset) { projectPage.value=1; appliedProjectKeyword=projectKeyword.value; }
  const sequence=++projectSequence;
  projectLoading.value=true;
  try{
    const page=await listProjects({page:projectPage.value,size:20,keyword:appliedProjectKeyword,
      filters:{status:"approved"}});
    if(sequence!==projectSequence)return;
    approvedProjects.value=page.items;
    projectTotal.value=page.total;
  }catch(e){if(sequence===projectSequence)ElMessage.error((e as Error).message)}
  finally{if(sequence===projectSequence)projectLoading.value=false}
}
function startCreate(){chooseProject.value=true;projectKeyword.value="";void loadProjects(true)}
function startSettlement(){
  if(projectContext.value)void selectProject(projectContext.value.id);
  else startCreate();
}
const projectSearch: CrudSearchConfig = {
  fields: [
    { type: "input", prop: "keywords", label: "子项目", attrs: { clearable: true, placeholder: "搜索项目名称或编号" } },
    historyScopeField("finance.show-deleted"),
  ],
};
const projectTable: CrudTableConfig<CrudRecord, ProjectRow> = {
  stateKey: "finance:projects",
  rowKey: "id",
  table: { border: true },
  tableTools: ["refresh", "columns", "search"],
  async fetchData(query) {
    const result = await listProjects({
      page: Number(query.pageNum) || 1,
      size: Number(query.pageSize) || 20,
      keyword: String(query.keywords || ""),
      ...nativeListQuery(query, ["display_status"], true),
    });
    return { list: result.items, total: result.total };
  },
  toolbarActions: [{ key: "create", label: "新增结算草稿", permission: "write", onClick: startCreate }],
  columns: [
    { prop: "name", label: "子项目", sortable: "custom", minWidth: 245, fixed: "left", cellType: "custom" },
    { prop: "code", label: "项目编号", sortable: "custom", minWidth: 160 },
    { prop: "approval", label: "批准预算", minWidth: 150, cellType: "custom" },
    { prop: "display_status", label: "项目状态", minWidth: 120, sortable: "custom", cellType: "custom", hideable: false,
      ...nativeColumnFilter("display_status", projectStatusChoices, true) },
  ],
};

let settlementListSequence=0;
const searchConfig:CrudSearchConfig={
  fields:[{type:"input",prop:"keywords",label:"结算单",attrs:{
    placeholder:"结算编号 / 项目名称 / 项目编号",clearable:true}},
    historyScopeField("finance.show-deleted"),
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"settlements" + ":" + (projectId ?? "portfolio"),
  table:{border:true},rowKey:"id",
  fetchData:async query=>{
    const sequence=++settlementListSequence;
    const q=query as {pageNum?:number;pageSize?:number;keywords?:string};
    const result=await listSettlements({page:q.pageNum||1,
      size:q.pageSize||20,keyword:q.keywords||"",projectId:projectId,...nativeListQuery(query, ["status"])});
    if(sequence===settlementListSequence) settlementQuery.value = applyNativeListQuery(new URLSearchParams({ q: q.keywords || "" }), nativeListQuery(query, ["status"])).toString();
    return {list:result.items,total:result.total};
  },
  toolbarActions:[
    {key:"create",label:"新增结算草稿",permission:"write",
      visible:()=>!projectId||(projectContext.value?.status === "approved" && !projectContext.value.deleted),onClick:startSettlement},
    {key:"exchange",label:"导入 Excel",permission:"write",
      visible:()=>Boolean(projectId) && (projectContext.value?.status === "approved" && !projectContext.value.deleted),
      onClick:()=>{ exchangeOpen.value = true; }},
  ],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"number",sortable:"custom",label:"结算编号",minWidth:165,fixed:"left"},
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",["draft","submit","approve","return","reject","voided"].map(value=>({value,text:settlementStatusText(value)}))),label:"状态",cellType:"custom",minWidth:118},
    {prop:"amount",sortable:"custom",sortField:"amount_fen",label:"本次金额",cellType:"custom",minWidth:145},
    {prop:"effective_amount_fen",sortable:"custom",label:"已生效金额",cellType:"custom",minWidth:140},
    {prop:"project_name",sortable:"custom",label:"所属项目",cellType:"custom",minWidth:180},
    {prop:"project_code",sortable:"custom",label:"项目编号",minWidth:145},
    {prop:"created_at",sortable:"custom",label:"创建时间",cellType:"custom",minWidth:180},
    {prop:"actions",label:"操作",cellType:"actions",fixed:"right",width:200,
      actions:[{key:"edit-draft",label:"编辑草稿",permission:"write",
        visible:({row})=>Boolean(row?.draft) && !row?.deleted && (!projectContext.value || (projectContext.value.status === "approved" && !projectContext.value.deleted)),
        onClick:({row})=>row&&openWork("SettlementEdit",String(row.id))},{key:"detail",label:"查看详情",permission:"read",
        onClick:({row})=>row&&showDetails(String(row.id))}]},
  ],
};
onMounted(async () => {
  if (!projectId) return;
  try {
    projectContext.value = await projectDetail(projectId, origin.archive === "true");
  } catch (cause) {
    contextError.value = (cause as Error).message;
  }
});
</script>
