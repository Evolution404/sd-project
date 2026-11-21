
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import type { ScenarioStep, TrainingScenario } from "../../../../server/shared/types/training";
import { api } from "../../shared/api/client";
import { hasActiveGuideWorkspace, isGuideRecordOpen } from "../core/target-resolver";

const emit = defineEmits<{ navigate: [] }>();
const router = useRouter();
const scenario = ref<TrainingScenario | null>(null);
const loading = ref(true);
const error = ref("");
const feedback = ref("");
const labels: Record<ScenarioStep, { title: string; instructions: string }> = {
  register: { title:"登记专业需求", instructions:"选择「【训练】防鸟装置安装」，填写现场问题和预计解决时间。在「【训练】青禾线」选一至两基杆塔，填写装置数量，保存需求。" },
  "return-demand": { title:"确认并退回需求", instructions:"打开刚登记的需求，先点「确认并待承接」。在需求详情的更多操作中选择「退回」，核对提示后确认。" },
  "revise-demand": { title:"修订需求并重新确认", instructions:"修改已退回需求的工作量或问题描述并保存，回到同一需求详情，再次确认并进入待承接。" },
  link: { title:"创建子项目并承接", instructions:"以当前需求创建子项目，选择「【训练】输电检修年度框架」，保存并承接整条需求。" },
  approve: { title:"入库并完成首次立项", instructions:"先办理入库，进入立项与变更。纳入完整需求范围，编制并批准立项。可用 12,000 元作为批准预算。" },
  change: { title:"批准一次项目变更", instructions:"在立项与变更中发起新变更。可将批准预算改为 13,000 元，填写依据，保留原需求并正式批准。" },
  cost: { title:"核定实际费用", instructions:"进入项目财务，新增末级费用科目，例如「人工费」，再核定一笔实际费用。建议登记 10,000 元。" },
  review: { title:"按项目总额结算并原版重提", instructions:"新增结算，按项目总额填 6,000 元并送审。审核时退回并说明原因，然后在原单使用原版本重提，最后批准。" },
  itemized: { title:"再做一期按子费用结算", instructions:"用同一项目的最新批准范围再新增一张结算，切换到按子费用，选择人工费并录入 3,800 元。送审并批准，核对累计结算进度。" },
  close: { title:"核对差额并结项", instructions:"返回项目概览，在结项核对页查看真实费用、累计批准结算和差额。确认后可回到项目历史查看结项结果。" },
};
const steps = computed(() => scenario.value?.steps ?? []);
const current = computed(() => steps.value.find(step => !step.completed));
const facts = computed(() => scenario.value?.facts);
const percent = computed(() => scenario.value?.progressPercent ?? null);
const money = new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"});
const status = computed(() => {
  const value = facts.value;
  if (!value) return "尚未登记需求";
  if (value.projectStage === "closed") return "已结项";
  if (value.changedApproval) return "已批准项目变更";
  if (value.firstApproval) return "已完成立项";
  if (value.projectStage === "stocked") return "项目已入库";
  if (value.projectId) return "需求已承接";
  return { pending:"待确认",returned:"已退回",active:"待承接" }[value.demandStatus];
});
const billText = computed(() => {
  const value = facts.value;
  if (!value?.totalBillStatus) return "";
  if (value.totalBillStatus === "submit" && value.totalBillResubmitted) return "原版已重提，待审核";
  return { draft:"草稿",submit:"待审核",return:"已退回",reject:"已驳回",approve:"已批准" }[value.totalBillStatus];
});

async function refresh() {
  loading.value = true;
  error.value = "";
  feedback.value = "";
  try {
    scenario.value = (await api<{ scenario: TrainingScenario | null }>("/training/journey")).scenario;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "无法读取实操进度";
  } finally { loading.value = false; }
}

function destination(id: ScenarioStep | undefined): RouteLocationRaw {
  const entry = facts.value;
  if (!entry || id === "register") return { name:"demands",params:{editMode:"new"} };
  if (id === "return-demand" || id === "revise-demand") {
    return { name:"demands",query:{demand:entry.demandId} };
  }
  if (id === "link") return { name:"projects",query:{ action:"create",demand:entry.demandId } };
  if (id === "cost" || id === "review" || id === "itemized") {
    if (id === "review" && entry.totalBillId && entry.totalBillStatus === "submit") {
      return { name:"projects",params:{projectId:entry.projectId!,work:"settlements",recordId:entry.totalBillId,recordAction:"review"} };
    }
    return { name:"projects",params:{projectId:entry.projectId!,work:"finance"} };
  }
  return { name:"projects",params:{projectId:"",work:"",recordId:"",recordAction:""},query:{ project:entry.projectId, tab:id === "change" || (id === "approve" && entry.projectStage === "stocked")
    ? "approval" : id ? "overview" : "history" } };
}

async function proceed() {
  const step = current.value?.id;
  const demandOpen = isGuideRecordOpen("demand",facts.value?.demandId);
  const projectOpen = isGuideRecordOpen("project",facts.value?.projectId);
  const next = destination(step);
  const sameRoute = router.resolve(next).fullPath === router.currentRoute.value.fullPath;
  if (sameRoute || (demandOpen && (step === "return-demand" || step === "revise-demand"))) {
    emit("navigate");
    return;
  }
  if (hasActiveGuideWorkspace() && !projectOpen && !(demandOpen && step === "link")) {
    feedback.value = "请先保存或关闭正在办理的记录，再转到下一步。";
    return;
  }
  try {
    if (await router.push(next)) {
      feedback.value = "请先处理当前业务提示，再继续实操。";
      return;
    }
    emit("navigate");
  } catch { feedback.value = "无法打开办理位置，请重试。"; }
}
onMounted(refresh);
</script>

<template>
  <section aria-label="需求和项目全流程实操" class="scenario" v-loading="loading">
    <ElAlert v-if="error" type="error" :closable="false" :title="error" />
    <template v-else-if="scenario">
      <h3>青禾线防鸟治理</h3>
      <p class="scenario-context">独立训练环境 · {{ status }}</p>
      <dl v-if="facts" class="scenario-facts">
        <template v-if="facts.demandNumber"><div><dt>需求</dt><dd>{{ facts.demandNumber }} · 第 {{ facts.demandVersion }} 版</dd></div></template>
        <template v-if="facts.projectNumber"><div><dt>项目</dt><dd>{{ facts.projectNumber }}</dd></div></template>
        <template v-if="facts.firstApproval"><div><dt>批准版本</dt><dd>第 {{ facts.changedApproval || facts.firstApproval }} 版</dd></div></template>
        <template v-if="billText"><div><dt>总额结算单</dt><dd>{{ billText }}</dd></div></template>
        <template v-if="facts.projectNumber">
          <div><dt>核定实际费用</dt><dd>{{ money.format(facts.actualCost / 100) }}</dd></div>
          <div><dt>累计已批准结算</dt><dd>{{ money.format(facts.approvedAmount / 100) }}</dd></div>
          <div><dt>结算进度</dt><dd>{{ percent === null ? "待核定费用基数" : percent + "%" }}</dd></div>
        </template>
      </dl>
      <ElAlert v-if="feedback" :title="feedback" type="warning" :closable="false" />
      <ElAlert v-else-if="!scenario.canProceed" title="请使用训练管理员账号办理。当前账号可核对案例状态。" type="info" :closable="false" />
      <ElAlert v-else-if="facts?.closed && current" title="项目已结项，当前案例仍有未完成环节。可启动另一个独立训练实例重练。" type="warning" :closable="false" />
      <ElAlert v-else-if="!current" title="全流程已完成。可以回查批准版本和结项结果。" type="success" :closable="false" />
      <div v-if="current" class="scenario-next">
        <h4>{{ labels[current.id].title }}</h4>
        <p>{{ labels[current.id].instructions }}</p>
      </div>
      <div class="scenario-actions">
        <ElButton v-if="(scenario.canProceed && !facts?.closed) || !current" type="primary" @click="proceed">
          {{ current ? "前往办理" : "查看结项历史" }}
        </ElButton>
        <ElButton :loading="loading" @click="refresh">核对业务进度</ElButton>
      </div>
      <ol class="scenario-steps">
        <li v-for="step in steps" :key="step.id" :aria-current="step === current ? 'step' : undefined">
          <span>{{ labels[step.id].title }}</span>
          <ElTag v-if="step.completed" type="success" size="small">已完成</ElTag>
          <ElTag v-else-if="step === current" size="small">当前步骤</ElTag>
        </li>
      </ol>
    </template>
    <template v-else-if="!loading">
      <h3>需求到结项</h3>
      <p>由管理员使用安装包中的「启动训练环境」创建独立实例，再登录它显示的本机地址。</p>
      <p>登录训练实例后，回到「使用指引」中的「全流程实操」。每项进度由实际业务记录核验。</p>
    </template>
    <ElButton v-if="error" :loading="loading" @click="refresh">重试</ElButton>
  </section>
</template>

<style scoped>
.scenario { min-height: 120px; }
.scenario h3 { margin: 0 0 5px; }
.scenario-context { color: var(--muted); margin: 0 0 12px; }
.scenario-facts {
  display: grid; grid-template-columns: repeat(auto-fit,minmax(145px,1fr)); gap: 13px;
  margin: 14px 0; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 8px;
}
.scenario-facts dt { color: var(--muted); font-size: 12px; }
.scenario-facts dd { margin: 4px 0 0; font-weight: 600; }
.scenario-next h4 { margin: 12px 0 4px; }
.scenario-next p { margin: 0 0 12px; }
.scenario-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.scenario-actions .el-button { margin:0; }
.scenario-steps { padding-left: 1.6rem; margin: 14px 0 0; }
.scenario-steps li { padding: 6px 0; }
.scenario-steps .el-tag { margin-left: 8px; }
</style>

