<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, quantity } from "../../../shared/api/client";
import { demandDisplayStatus } from "../../../../../server/shared/demand-display-status";
import type { DemandRecord, DemandLocation } from "../../../../../server/shared/types/demands";
import type { DemandDraft, LocationDraft } from "../types/demand";

export interface DuplicateCandidate {
  id: string;
  demand_no: string;
}
const props = defineProps<{
  open: boolean;
  candidates: DuplicateCandidate[];
  draft: DemandDraft;
  operationName: string;
  unit: string;
  submitting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  park: [];
  confirm: [reason: string, tokens: Record<string, string>];
}>();
const activeId = ref("");
const loaded = ref<Record<string, DemandRecord & { duplicate_review_token: string }>>({});
const loading = ref(false);
const loadError = ref("");
const reason = ref("");
const reviewed = ref(false);
let sequence = 0;

function identity(row: { logical_tower_id?: string | null; physical_tower_id?: string | null; span_id?: string | null }) {
  return row.logical_tower_id ? "logical/" + row.logical_tower_id
    : row.physical_tower_id ? "physical/" + row.physical_tower_id
      : row.span_id ? "span/" + row.span_id : "";
}
const selected = computed(() => loaded.value[activeId.value]);
const allLoaded = computed(() => props.candidates.length > 0 &&
  props.candidates.every(item => Boolean(loaded.value[item.id])));
const matched = computed(() => {
  const locations = selected.value?.work_locations || [];
  const current = new Set(props.draft.work_locations.map(identity));
  return new Set(locations.map(identity).filter(key => key && current.has(key)));
});
const canConfirm = computed(() =>
  allLoaded.value && !loading.value && !props.submitting && reviewed.value && !!reason.value.trim());
const activeCandidate = computed(() => props.candidates.find(item => item.id === activeId.value));
const statusName = (row: DemandRecord) => row.deleted ? "已删除"
  : demandDisplayStatus(row.status, Boolean(row.binding));

function label(row: LocationDraft | DemandLocation) {
  if ("label" in row) return [row.line_name, row.label].filter(Boolean).join(" · ");
  const snapshot = row.location_snapshot_json;
  return [snapshot?.line_name, snapshot?.location_label || snapshot?.tower_no || snapshot?.physical_code]
    .filter(Boolean).join(" · ");
}
async function loadRecords() {
  const run = ++sequence;
  loading.value = true;
  loadError.value = "";
  const candidates = props.candidates.slice();
  const records = await Promise.allSettled(candidates.map(item =>
    api<DemandRecord & { duplicate_review_token: string }>("/demands/" + encodeURIComponent(item.id) + "?deleted=true")));
  if (run !== sequence || !props.open) return;
  const next: Record<string, DemandRecord & { duplicate_review_token: string }> = {};
  const failed: string[] = [];
  records.forEach((result, index) => {
    if (result.status === "fulfilled") next[candidates[index]!.id] = result.value;
    else failed.push(candidates[index]!.demand_no);
  });
  loaded.value = next;
  loading.value = false;
  if (failed.length) loadError.value = "以下需求读取失败：" + failed.join("、") + "。请重试后再作出独立保留决定。";
}
watch(() => [props.open, props.candidates] as const, ([open]) => {
  ++sequence;
  if (!open) return;
  activeId.value = props.candidates[0]?.id || "";
  reason.value = "";
  reviewed.value = false;
  loaded.value = {};
  void loadRecords();
}, { immediate: true });
function confirm() {
  if (canConfirm.value) emit("confirm", reason.value.trim(), Object.fromEntries(props.candidates.map(item => [item.id, loaded.value[item.id]!.duplicate_review_token])));
}
</script>

<template>
  <section v-if="open" class="demand-duplicate-review" aria-label="疑似重复需求核对">
    <h2>疑似重复需求核对</h2>
    <ElAlert type="warning" :closable="false" show-icon
      title="发现相同操作类型、相同作业位置的既有需求"
      description="请直接对比现场事实。返回修改不会清空本次填写内容；只有确认两者确属独立需求并说明依据后，才会再次提交保存。" />
    <div class="duplicate-review-count">
      疑似重复 <strong>{{ candidates.length }}</strong> 条
      <span class="muted">逐条核对已有正式记录。</span>
    </div>
    <div v-if="candidates.length > 1" class="duplicate-candidate-list" role="group" aria-label="选择待核对的重复需求">
      <ElButton v-for="item in candidates" :key="item.id"
        :type="activeId === item.id ? 'primary' : 'default'"
        :plain="activeId !== item.id"
        @click="activeId = item.id">{{ item.demand_no }}</ElButton>
    </div>
    <ElAlert v-if="loadError" type="error" :closable="false" show-icon :title="loadError">
      <ElButton size="small" @click="loadRecords">重新读取重复需求</ElButton>
    </ElAlert>
    <div v-if="loading" v-loading="true" class="duplicate-review-loading" aria-label="正在读取历史需求" />
    <div v-else class="duplicate-compare">
      <section class="duplicate-side duplicate-current">
        <div class="duplicate-side-head">
          <h3>当前待保存需求</h3>
          <ElTag type="info" effect="plain">未保存</ElTag>
        </div>
        <ElDescriptions :column="1" border>
          <ElDescriptionsItem label="操作类型">{{ operationName || "未选择" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="问题描述">{{ draft.problem_description || "未填写" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="验收标准">{{ draft.completion_standard || "未填写" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="作业位置">{{ draft.work_locations.length }} 处</ElDescriptionsItem>
        </ElDescriptions>
        <h4>作业位置及需求数量</h4>
        <div v-if="!draft.work_locations.length" class="muted">尚未添加位置</div>
        <div v-for="(location, index) in draft.work_locations" :key="index" class="duplicate-location"
          :class="{ 'duplicate-location-match': matched.has(identity(location)) }">
          <span class="duplicate-location-name">{{ label(location) }}</span>
          <strong class="duplicate-quantity">{{ quantity(location.quantity_scaled) }} {{ unit }}</strong>
          <ElTag v-if="matched.has(identity(location))" type="warning" size="small">位置重合</ElTag>
        </div>
        <h4>来源依据</h4>
        <p v-for="(source, index) in draft.sources.filter(row => row.action !== 'delete' && row.description)" :key="index" class="duplicate-detail-note">
          {{ source.description }} <span class="muted">{{ source.discovered_on }}</span>
        </p>
        <p v-if="!draft.sources.some(row => row.action !== 'delete' && row.description)" class="muted">暂无来源说明</p>
      </section>
      <section class="duplicate-side duplicate-existing">
        <div class="duplicate-side-head">
          <h3>既有正式需求</h3>
          <ElTag v-if="selected" type="success" effect="plain">{{ statusName(selected) }}</ElTag>
        </div>
        <template v-if="selected">
          <div class="duplicate-reference">
            <strong>{{ selected.demand_no }}</strong>
            <span class="muted">正式定义第 {{ selected.current_version }} 版</span>
          </div>
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="操作类型">{{ selected.operation_snapshot }}</ElDescriptionsItem>
            <ElDescriptionsItem label="问题描述">{{ selected.problem_description }}</ElDescriptionsItem>
            <ElDescriptionsItem label="验收标准">{{ selected.completion_standard }}</ElDescriptionsItem>
            <ElDescriptionsItem label="承接状态">{{ selected.binding ? "已由子项目承接" : "未关联子项目" }}</ElDescriptionsItem>
          </ElDescriptions>
          <h4>作业位置及需求数量</h4>
          <div v-for="(location, index) in selected.work_locations" :key="index" class="duplicate-location"
            :class="{ 'duplicate-location-match': matched.has(identity(location)) }">
            <span class="duplicate-location-name">{{ label(location) }}</span>
            <strong class="duplicate-quantity">{{ quantity(location.quantity_scaled) }} {{ selected.unit_snapshot }}</strong>
            <ElTag v-if="matched.has(identity(location))" type="warning" size="small">位置重合</ElTag>
          </div>
          <h4>来源依据</h4>
          <p v-for="source in selected.sources" :key="source.id" class="duplicate-detail-note">
            {{ source.description }} <span class="muted">{{ source.discovered_on }}</span>
          </p>
          <p v-if="!selected.sources.length" class="muted">暂无来源说明</p>
          <h4 v-if="selected.materials.length">预计物资</h4>
          <p v-for="material in selected.materials" :key="material.material_id" class="duplicate-detail-note">
            {{ material.material_name }} · {{ material.model }} · {{ quantity(material.quantity_scaled) }} {{ material.unit_snapshot }}
          </p>
        </template>
        <div v-else-if="!loadError" class="muted">正在读取 {{ activeCandidate?.demand_no || '需求' }} 的正式记录</div>
      </section>
    </div>
    <div class="duplicate-decision">
      <ElForm label-position="top" novalidate>
        <ElFormItem label="独立保留依据（必填）" required>
          <ElInput v-model="reason" type="textarea" :rows="2"
            placeholder="请说明为什么同一操作、同一位置仍需要单独立项，例如故障性质、实际作业任务或发现批次不同" />
        </ElFormItem>
        <ElCheckbox v-model="reviewed">
          我已核对上述 {{ candidates.length }} 条正式需求，确认本次需求属于不同的现场任务。
        </ElCheckbox>
        <p class="muted duplicate-decision-hint">
          独立保留会记录匹配需求编号和判断依据；若内容实际重复，应返回编辑并删除或调整重合位置。
        </p>
      </ElForm>
    </div>
    <div class="duplicate-review-actions">
      <ElButton :disabled="submitting" @click="emit('park')">暂存并返回</ElButton>
      <ElButton :disabled="submitting" @click="emit('close')">返回继续修改</ElButton>
      <ElButton type="primary" :loading="submitting" :disabled="!canConfirm" @click="confirm">
        确认独立并保存
      </ElButton>
    </div>
  </section>
</template>

<style scoped>
.demand-duplicate-review > h2 { margin:0 0 12px; font-size:18px }
.duplicate-review-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px }
.duplicate-review-actions .el-button + .el-button { margin-left:0 }
.duplicate-review-count {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0 12px;
  font-size: 13px;
}
.duplicate-candidate-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 14px;
}
.duplicate-candidate-list .el-button + .el-button {margin-left:0}
.duplicate-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
.duplicate-review-loading {min-height:220px}
.duplicate-side {
  padding: 16px;
  border: 1px solid var(--edge);
  border-radius: 12px;
  min-width: 0;
  background: var(--surface);
}
.duplicate-current {background:var(--surface-subtle)}
.duplicate-side-head {display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:12px}
.duplicate-side h3 {font-size:15px;font-weight:650;margin:0;color:var(--ink)}
.duplicate-side h4 {font-size:13px;font-weight:650;margin:17px 0 8px;color:var(--ink)}
.duplicate-reference {display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;overflow-wrap:anywhere}
.duplicate-reference strong {font-size:13px;color:var(--ink)}
.duplicate-location {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:9px 10px;
  margin-bottom:5px;
  border-radius:8px;
  font-size:12px;
  border:1px solid transparent;
}
.duplicate-location:nth-of-type(even) {background:var(--surface-subtle)}
.duplicate-location-match {
  background:var(--brand-soft)!important;
  border-color:var(--brand-primary);
}
.duplicate-location-name {flex:1 1 140px;min-width:0;overflow-wrap:anywhere}
.duplicate-quantity {white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink)}
.duplicate-detail-note {font-size:12px;line-height:1.65;margin:6px 0;overflow-wrap:anywhere}
.duplicate-decision {
  margin-top:17px;
  padding:15px 16px;
  border:1px solid var(--edge);
  border-radius:11px;
  background:var(--surface-subtle);
}
.duplicate-decision :deep(.el-form-item) {margin-bottom:12px}
.duplicate-decision-hint {font-size:12px;line-height:1.55;margin:8px 0 0}
@media(max-width:780px){
  .duplicate-compare {grid-template-columns:1fr}
  .duplicate-side {padding:12px}
}
</style>
