<template>
  <el-dialog :model-value="true" title="批准范围参考报价" width="min(95vw, 900px)" append-to-body
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="emit('close')">
    <el-form label-position="top" novalidate :disabled="busy">
      <el-form-item label="价格适用日期">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" />
      </el-form-item>
      <el-alert v-if="stale" class="mb-3" type="warning" :closable="false"
        title="计价条件已修改，请重新试算后确认报价" />
      <template v-if="result">
        <el-alert class="mb-3" :type="result.complete ? 'success' : 'warning'" :closable="false"
          :title="result.complete ? '完整参考价 ' + projectMoney(result.total_fen) : '未完整计价，已计价小计 ' + projectMoney(result.subtotal_fen)" />
        <el-table :data="result.lines" row-key="location_item_no" border max-height="290" empty-text="暂无可计价位置">
          <el-table-column prop="location_item_no" label="位置序号" width="92" />
          <el-table-column prop="rule_title" label="匹配价格规则" min-width="180" />
          <el-table-column prop="rule_version_no" label="规则版本" width="92" />
          <el-table-column label="计价数量" width="95">
            <template #default="{ row }">{{ formatScaledDecimal(row.quantity_scaled, 4) }}</template>
          </el-table-column>
          <el-table-column label="参考金额" min-width="110">
            <template #default="{ row }">{{ projectMoney(row.amount_fen) }}</template>
          </el-table-column>
        </el-table>
        <el-card v-for="row in result.missing" :key="row.location_item_no" class="mt-3" shadow="never">
          <p class="mb-2">位置 {{ row.location_item_no }}：{{ row.reason }}</p>
          <template v-if="row.candidates.length > 1">
            <el-form-item label="正式规则选择">
              <el-select v-model="selections[row.location_item_no]" filterable>
                <el-option v-for="rule in row.candidates" :key="rule.id" :value="rule.id" :label="rule.title" />
              </el-select>
            </el-form-item>
            <el-form-item label="明确选价依据" required><el-input v-model="selectionReasons[row.location_item_no]" /></el-form-item>
          </template>
          <template v-if="row.needs_basis">
            <el-form-item v-for="field in basisFields" :key="field.key" :label="field.label">
              <el-input v-model="amounts[row.location_item_no][field.key]" inputmode="decimal" />
            </el-form-item>
            <el-form-item label="计费基数依据" required><el-input v-model="basisEvidence[row.location_item_no]" /></el-form-item>
          </template>
          <el-collapse v-if="row.diagnostics?.length">
            <el-collapse-item title="查看未匹配的规则和原因">
              <ul>
                <li v-for="diagnostic in row.diagnostics" :key="diagnostic.title">
                  <div>{{ diagnostic.title }}</div><div>{{ diagnostic.reasons.join("；") }}</div>
                </li>
              </ul>
            </el-collapse-item>
          </el-collapse>
        </el-card>
      </template>
    </el-form>
    <template #footer>
      <el-button :disabled="busy" @click="emit('close')">关闭报价</el-button>
      <el-button :loading="busy" data-guide-action="projects.quote" @click="calculate(false)">试算</el-button>
      <el-button type="primary" :loading="busy" :disabled="!result?.complete || stale || Boolean(result.id)"
        data-guide-action="pricing.quote-confirm" @click="calculate(true)">确认正式报价</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { quoteProjectScope, type QuoteInput, type QuoteResult } from "@/api/business/pricing";
import { yuanToFen } from "@/api/business/funding";
import { projectMoney, type ApprovedProjectScope } from "@/api/business/projects";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";

const props = defineProps<{ scope: ApprovedProjectScope }>();
const emit = defineEmits<{ close: []; confirmed: [] }>();
const date = ref(new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date()));
const basisFields = [
  { key: "labor", label: "人工费用基数（元）" },
  { key: "materials", label: "材料费用基数（元）" },
  { key: "machinery", label: "机械费用基数（元）" },
] as const;
const selections = ref<Record<number, string>>({});
const selectionReasons = ref<Record<number, string>>({});
const amounts = ref<Record<number, Partial<Record<(typeof basisFields)[number]["key"], string>>>>({});
const basisEvidence = ref<Record<number, string>>({});
const result = ref<QuoteResult>();
const busy = ref(false);
const trialInputs = ref("");
const signature = computed(() => JSON.stringify([date.value, selections.value, selectionReasons.value, amounts.value, basisEvidence.value]));
const stale = computed(() => Boolean(result.value && trialInputs.value !== signature.value));

function requestInput(): QuoteInput {
  const bases: QuoteInput["bases"] = {};
  for (const [position, values] of Object.entries(amounts.value)) {
    const evidence = basisEvidence.value[Number(position)]?.trim();
    const entries = Object.entries(values).filter(([, value]) => Boolean(value?.trim()));
    if (evidence || entries.length) {
      bases[position] = Object.fromEntries(entries.map(([key, value]) => [key, yuanToFen(value!)]));
      if (evidence) bases[position].evidence = evidence;
    }
  }
  return {
    expected_version: props.scope.demand_version, approval_scope_version_id: props.scope.id, pricing_date: date.value,
    selections: selections.value, selection_basis: selectionReasons.value, bases,
  };
}

async function calculate(confirm: boolean) {
  if (busy.value || (confirm && (!result.value?.complete || stale.value || result.value.id))) return;
  busy.value = true;
  try {
    const before = signature.value;
    const previous = result.value;
    const quote = await quoteProjectScope(props.scope.demand_id, {
      ...requestInput(), confirm, ...(confirm ? { preview_hash: previous?.preview_hash } : {}),
    });
    for (const missing of quote.missing) {
      if (missing.needs_basis) amounts.value[missing.location_item_no] ??= {};
    }
    trialInputs.value = before === signature.value || !quote.complete ? signature.value : before;
    result.value = quote;
    if (confirm) {
      emit("confirmed");
      ElMessage.success("已保存正式参考报价");
    }
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  } finally {
    busy.value = false;
  }
}

onMounted(() => { void calculate(false); });
</script>
