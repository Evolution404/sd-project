<script setup lang="ts">
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable, {
  type TableColumn,
} from "../../shared/ui/BusinessTable.vue";
import {
  api,
  today,
  statusText,
  money,
  quantity,
} from "../../shared/api/client";
import type {
  QuoteResult,
  QuoteLine,
} from "../../../../server/shared/types/pricing";
import type { PricingTrace } from "../../../../server/modules/pricing/model";
const props = defineProps<{
  modelValue: boolean;
  demandId: string;
  expectedVersion: number;
  scopeId?: string;
}>();
const emit = defineEmits(["update:modelValue", "confirmed"]);
function traceText(line: QuoteLine) {
  const trace: Partial<PricingTrace> =
    typeof line.calculation_trace_json === "string"
      ? JSON.parse(line.calculation_trace_json)
      : line.calculation_trace_json || {};
  const pieces: string[] = [statusText[line.pricing_mode] || "正式计价"];
  if (line.pricing_mode === "fixed") pieces.push("按位置固定收费");
  if (line.pricing_mode === "per_unit") pieces.push("实际数量 × 单价");
  if (line.pricing_mode === "base_plus_unit")
    pieces.push("每个位置基础费 + 实际数量 × 单价");
  if (line.pricing_mode === "quantity_bracket")
    pieces.push("按数量所在的整批档位计价");
  if (line.pricing_mode === "progressive_bracket")
    pieces.push("各累进档分别计算后汇总");
  if (line.pricing_mode === "group") pieces.push("数量按组向上取整计价");
  if (line.pricing_mode === "rate") pieces.push("经核实的费用基数 × 费率");
  if (line.pricing_mode === "composite")
    pieces.push("组合费用项分别计算后汇总");
  pieces.push("金额以分为单位按四舍五入计算");
  if (trace.bracket) pieces.push("使用数量分档");
  return pieces.join(" · ");
}

const basisFields = [
  { key: "labor", label: "人工费用基数（元）" },
  { key: "materials", label: "材料费用基数（元）" },
  { key: "machinery", label: "机械费用基数（元）" },
] as const;
const priceColumns: TableColumn[] = [
  { key: "location_item_no", label: "位置序号", minWidth: 115 },
  { key: "rule_title", label: "匹配价格规则", minWidth: 190 },
  { key: "rule_version_no", label: "规则版本", minWidth: 105 },
  { key: "quantity_scaled", label: "计价数量", minWidth: 125 },
  { key: "amount_fen", label: "金额", minWidth: 145 },
];
const quote = ref<QuoteResult | null>(null),
  evaluatedInput = ref(""),
  busy = ref(false),
  selections = ref<Record<number, string>>({}),
  selectionBasis = ref<Record<number, string>>({}),
  bases = ref<
    Record<
      number,
      {
        labor?: number | null;
        materials?: number | null;
        machinery?: number | null;
        evidence?: string;
      }
    >
  >({}),
  date = ref(today());
function requestInput(confirm = false) {
  return {
    expected_version: props.expectedVersion,
    approval_scope_version_id: props.scopeId,
    pricing_date: date.value,
    confirm,
    selections: selections.value,
    selection_basis: selectionBasis.value,
    bases: bases.value,
  };
}
const currentInput = computed(() => JSON.stringify(requestInput(false)));
const stalePreview = computed(
  () => !!quote.value && evaluatedInput.value !== currentInput.value,
);
const canConfirm = computed(
  () =>
    !busy.value &&
    !stalePreview.value &&
    !!quote.value?.complete &&
    !quote.value?.id &&
    can("write"),
);
async function calculate(confirm = false) {
  if (busy.value) return;
  if (confirm && !canConfirm.value) {
    ElMessage.warning("计价条件已变化，请重新试算并核对金额");
    return;
  }
  const snapshot = JSON.parse(currentInput.value) as ReturnType<
    typeof requestInput
  >;
  busy.value = true;
  try {
    const result = await api<QuoteResult>(
      "/demands/" + props.demandId + "/quote",
      "POST",
      {
        ...snapshot,
        confirm,
        ...(confirm ? { preview_hash: quote.value?.preview_hash } : {}),
      },
    );
    quote.value = result;
    evaluatedInput.value = JSON.stringify(snapshot);
    for (const missing of result.missing || [])
      bases.value[missing.location_item_no] ||= {};
    if (confirm) {
      ElMessage.success("已保存正式参考报价");
      emit("confirmed");
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      quote.value = null;
      selections.value = {};
      evaluatedInput.value = "";
      date.value = today();
      selectionBasis.value = {};
      bases.value = {};
      calculate();
    }
  },
  { immediate: true },
);
</script>
<template>
  <ElDialog
    append-to-body
    :model-value="modelValue"
    title="参考价格"
    width="900px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    ><ElForm label-position="top" novalidate
      ><ElFormItem label="价格适用日期"
        ><ElDatePicker v-model="date" value-format="YYYY-MM-DD" /></ElFormItem
      ><ElAlert
        v-if="stalePreview"
        type="warning"
        :closable="false"
        title="计价条件已修改，上次金额仅供参考；请重新试算后才能确认正式报价" />
      <template v-if="quote"
        ><ElAlert
          :title="
            quote.complete
              ? '完整参考价 ¥' + money(quote.total_fen)
              : '未完整计价，已计价小计 ¥' + money(quote.subtotal_fen)
          "
          :type="quote.complete ? 'success' : 'warning'"
          :closable="false" /><BusinessTable
          client-side
          table-key="quote:locations"
          :rows="quote.lines || []"
          :columns="priceColumns"
          compact
        >
          <template #cell="{ row, column, value }">
            <span v-if="column.key === 'quantity_scaled'">{{
              quantity(row.quantity_scaled)
            }}</span>
            <span v-else-if="column.key === 'amount_fen'"
              >¥{{ money(row.amount_fen) }}</span
            >
            <span v-else>{{ value ?? "—" }}</span>
          </template>
        </BusinessTable>
        <ElCollapse v-if="quote.lines?.length" class="pricing-trace">
          <ElCollapseItem
            v-for="line in quote.lines"
            :key="line.location_item_no"
            :name="line.location_item_no"
            :title="
              '位置 ' +
              line.location_item_no +
              ' · ' +
              line.rule_title +
              '（V' +
              line.rule_version_no +
              '）'
            "
          >
            <ElDescriptions :column="1" border>
              <ElDescriptionsItem label="参考价格规则">{{
                line.rule_title
              }}</ElDescriptionsItem>
              <ElDescriptionsItem label="正式版本"
                >V{{ line.rule_version_no }}</ElDescriptionsItem
              >
              <ElDescriptionsItem label="计价方式">{{
                statusText[line.pricing_mode] || line.pricing_mode
              }}</ElDescriptionsItem>
              <ElDescriptionsItem label="计算依据">{{
                traceText(line)
              }}</ElDescriptionsItem>
              <ElDescriptionsItem label="计价数量">{{
                quantity(line.quantity_scaled)
              }}</ElDescriptionsItem>
              <ElDescriptionsItem label="本位置金额"
                >¥{{ money(line.amount_fen) }}</ElDescriptionsItem
              >
            </ElDescriptions>
          </ElCollapseItem>
        </ElCollapse>
        <div
          v-for="missing in quote.missing"
          :key="missing.location_item_no"
          class="panel"
        >
          <p>位置 {{ missing.location_item_no }} · {{ missing.reason }}</p>
          <ElCollapse v-if="missing.diagnostics?.length">
            <ElCollapseItem title="查看其他价格规则为什么不适用" name="reasons">
              <div
                v-for="(candidate, index) in missing.diagnostics"
                :key="index"
                class="panel"
              >
                <strong>{{ candidate.title }}</strong>
                <div class="toolbar" style="flex-wrap: wrap; margin-top: 6px">
                  <ElTag
                    v-for="reason in candidate.reasons"
                    :key="reason"
                    type="info"
                    effect="plain"
                    >{{ reason }}</ElTag
                  >
                </div>
              </div>
            </ElCollapseItem>
          </ElCollapse>
          <template v-if="missing.candidates?.length > 1"
            ><ElFormItem label="正式规则选择"
              ><ElSelect v-model="selections[missing.location_item_no]"
                ><ElOption
                  v-for="candidate in missing.candidates"
                  :key="candidate.id"
                  :value="candidate.id"
                  :label="candidate.title" /></ElSelect></ElFormItem
            ><ElFormItem label="选择依据" required
              ><ElInput
                v-model="
                  selectionBasis[missing.location_item_no]
                " /></ElFormItem
          ></template>
          <div v-if="missing.needs_basis" class="form-grid">
            <ElFormItem
              v-for="basis in basisFields"
              :key="basis.key"
              :label="basis.label"
              ><FieldControl
                v-model="bases[missing.location_item_no][basis.key]"
                :field="{ type: 'money' }" /></ElFormItem
            ><ElFormItem label="计费基数依据" required
              ><ElInput v-model="bases[missing.location_item_no].evidence"
            /></ElFormItem>
          </div></div></template></ElForm
    ><template #footer
      ><ElButton @click="emit('update:modelValue', false)">关闭报价</ElButton
      ><ElButton :loading="busy" @click="calculate()">重新试算</ElButton
      ><ElButton
        type="primary"
        :loading="busy"
        :disabled="!canConfirm"
        @click="calculate(true)"
        >确认正式报价</ElButton
      ></template
    ></ElDialog
  >
</template>
