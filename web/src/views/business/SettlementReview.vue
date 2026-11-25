<template>
  <section data-guide-workspace class="page-container" aria-label="结算审核办理">
    <el-card class="page-content" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">结算审核办理</h2>
          <div class="page-heading-actions flex flex-wrap gap-2">
            <el-button :disabled="acting" @click="returnToSource">{{ sourceQuery.source === "dashboard" ? "返回工作台" : "返回结算列表" }}</el-button>
            <template v-if="detail && !detail.deleted && !detail.write_blocked_reason">
              <template v-if="detail.draft && canWrite">
                <el-button data-guide-action="finance.edit-draft" :disabled="acting" @click="edit">编辑草稿</el-button>
                <el-button data-guide-action="finance.withdraw-settlement" :disabled="acting" @click="run('withdraw')">撤回草稿</el-button>
                <el-button data-guide-action="finance.submit" type="primary" :disabled="acting" @click="run('submit')">复核并提交审核</el-button>
              </template>
              <template v-else-if="detail.review?.action === 'submit' && canReview">
                <el-button data-guide-action="finance.return" :disabled="acting" @click="run('return')">退回结算</el-button>
                <el-button data-guide-action="finance.approve" type="primary" :disabled="acting" @click="run('approve')">审核通过</el-button>
              </template>
              <template v-else-if="canWrite && ['approve', 'return', 'reject'].includes(detail.status)">
                <el-button data-guide-action="finance.revise-settlement" :disabled="acting" @click="edit">编制修订</el-button>
                <el-button data-guide-action="finance.resubmit" v-if="detail.status === 'return'" type="primary" :disabled="acting"
                  @click="run('resubmit')">原版本重新提交</el-button>
              </template>
            </template>
          </div>
        </div>
      </template>
      <el-skeleton v-if="loading" animated :rows="8" />
      <el-alert v-else-if="loadError" type="error" :title="loadError" :closable="false">
        <el-button link type="primary" @click="load">重新读取</el-button>
      </el-alert>
      <template v-else-if="detail">
        <el-alert v-if="detail.review?.action === 'submit' && !canReview" class="mb-3"
          type="info" title="当前账号没有结算审核权限，可查看正式结算事实。" :closable="false" />
        <SettlementFacts :detail="detail" />
      </template>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import SettlementFacts from "@/components/business/SettlementFacts.vue";
import { settlementDetail, submitSettlement, reviewSettlement, resubmitSettlement,
  withdrawSettlementDraft, type SettlementDetails } from "@/api/business/finance";
import { useUserStore } from "@/stores/user";

type Action = "submit" | "approve" | "return" | "resubmit" | "withdraw";
const confirmations = {
  submit: ["提交结算审核", "提交后会生成正式待审核结算版本。确定继续？", "已提交结算审核"],
  approve: ["审核结算", "确认本次结算金额及全部解决量后审核通过？", "结算审核通过"],
  return: ["退回结算", "请填写退回原因", "结算已退回"],
  resubmit: ["原版本重新提交", "将原正式结算版本再次提交审核，确认继续？", "原版本已重新提交"],
  withdraw: ["撤回结算草稿", "确定撤回本次结算草稿？", "结算草稿已撤回"],
} satisfies Record<Action, [string, string, string]>;

const router = useRouter();
const route = useRoute();
const user = useUserStore();
const settlementId = String(route.params.settlementId);
const sourceQuery = { ...route.query };
const canWrite = computed(() => user.userInfo.perms.includes("write"));
const canReview = computed(() => user.userInfo.perms.includes("settlement.approve"));
const detail = ref<SettlementDetails>();
const loadError = ref("");
const loading = ref(false);
const acting = ref(false);

function returnToSource() {
  return router.push(sourceQuery.source === "dashboard" ? { name: "Dashboard" } : { name: "Finance", query: sourceQuery });
}
function edit() {
  return router.push({ name: "SettlementEdit", params: { settlementId }, query: sourceQuery });
}
async function load() {
  loading.value = true;
  loadError.value = "";
  detail.value = undefined;
  try {
    detail.value = await settlementDetail(settlementId);
  } catch (cause) {
    loadError.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}
async function run(action: Action) {
  const row = detail.value;
  if (!row || acting.value) return;
  const [title, message, success] = confirmations[action];
  acting.value = true;
  let withdrawn = false;
  try {
    if (action === "return") {
      const result = await ElMessageBox.prompt(message, title, {
        inputValidator: value => Boolean(value?.trim()) || "退回原因不能为空",
        type: "warning",
      });
      await reviewSettlement(row, action, result.value);
    } else {
      await ElMessageBox.confirm(message, title, { type: "warning" });
      switch (action) {
        case "submit": await submitSettlement(row); break;
        case "approve": await reviewSettlement(row, action, ""); break;
        case "resubmit": await resubmitSettlement(row); break;
        case "withdraw": await withdrawSettlementDraft(row); withdrawn = true; break;
      }
    }
    if (!withdrawn) await load();
    ElMessage.success(success);
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") ElMessage.error((cause as Error).message);
  } finally {
    acting.value = false;
  }
  if (withdrawn) await returnToSource();
}

onMounted(load);
onBeforeRouteLeave(() => !acting.value);
onBeforeRouteUpdate(() => !acting.value);
</script>
