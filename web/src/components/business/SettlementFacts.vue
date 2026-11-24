<template>
  <el-descriptions border :column="2">
    <el-descriptions-item label="结算编号">{{ detail.number }}</el-descriptions-item>
    <el-descriptions-item label="当前状态">
      {{ settlementStatusText(detail.status) }}
    </el-descriptions-item>
    <el-descriptions-item label="草稿金额">
      {{ projectMoney(detail.draft?.document.amount_fen) }}
    </el-descriptions-item>
    <el-descriptions-item label="当前生效金额">
      {{ projectMoney(detail.effective_amount_fen) }}
    </el-descriptions-item>
    <el-descriptions-item label="结算版本">{{ detail.version?.version_no || "尚未提交" }}</el-descriptions-item>
    <el-descriptions-item label="结算方式">
      {{ (detail.draft?.document.mode ?? detail.version?.mode) === "itemized" ? "按子费用" : "按项目总额" }}
    </el-descriptions-item>
    <el-descriptions-item label="审核意见">{{ detail.review?.reason || "—" }}</el-descriptions-item>
    <el-descriptions-item label="批准版本">
      V{{ detail.document_details?.approval_version_no || "—" }}
    </el-descriptions-item>
  </el-descriptions>
  <template v-if="detail.document_details?.items.length">
    <el-divider>结算子费用</el-divider>
    <el-table :data="detail.document_details.items" border max-height="330">
      <el-table-column prop="cost_node_name" label="费用科目" min-width="170" />
      <el-table-column label="本次金额" min-width="120">
        <template #default="{ row }">{{ projectMoney(row.amount_fen) }}</template>
      </el-table-column>
      <el-table-column prop="evidence" label="结算依据" min-width="180" />
    </el-table>
  </template>
  <el-divider>本次工作量对应需求位置</el-divider>
  <el-table :data="detail.document_details?.resolutions || []" border max-height="430">
    <el-table-column label="需求编号" min-width="145">
      <template #default="{row}">{{ row.demand.demand_no }}</template>
    </el-table-column>
    <el-table-column prop="demand.problem_description" label="问题描述" min-width="210" />
    <el-table-column prop="location_item_no" label="批准位置序号" min-width="125" />
    <el-table-column label="解决量" min-width="105">
      <template #default="{row}">{{ formatScaledDecimal(row.resolved_quantity_scaled, 4) }}</template>
    </el-table-column>
    <el-table-column prop="demand.unit" label="计量单位" min-width="100" />
    <el-table-column prop="evidence" label="完成依据" min-width="180"/>
  </el-table>
  <el-empty v-if="!(detail.document_details?.resolutions?.length)" description="暂无位置解决明细"/>
  <template v-if="detail.version?.id">
    <el-divider>正式结算版本附件</el-divider>
    <BusinessEvidence :key="detail.version.id" :owner="detail.version.id" kind="settlement_version_id" :readonly="detail.deleted" />
  </template>
</template>

<script setup lang="ts">
import { projectMoney } from "@/api/business/projects";
import type { SettlementDetails } from "@/api/business/finance";
import { settlementStatusText } from "@/utils/business/settlement-status";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";
import BusinessEvidence from "@/components/business/BusinessEvidence.vue";

defineProps<{ detail: SettlementDetails }>();
</script>
