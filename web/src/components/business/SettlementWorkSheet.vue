<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { settlementWorksheet, type SettlementResolutionInput, type WorkPosition } from "@/api/business/finance";
import { ThemeMode } from "@/enums";
import { useSettingsStore } from "@/stores/settings";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";
import type { createSettlementWorksheet, QuantityIssue, WorksheetEntries } from "./settlement-worksheet";
import WorksheetViewport from "@/components/BusinessWorksheet/WorksheetViewport.vue";

const props = defineProps<{
  projectId: string;
  approvalId: string;
  settlementId?: string;
  resolutions: ReadonlyArray<SettlementResolutionInput>;
}>();
const emit = defineEmits<{ "readiness-change": [ready: boolean] }>();

const settings = useSettingsStore();
const host = ref<HTMLElement>();
const validationPanel = ref<HTMLElement>();
const error = ref("");
const ready = ref(false);
const loading = ref(true);
const rows = shallowRef<readonly WorkPosition[]>([]);
const entries = shallowRef<WorksheetEntries>({});
let original: WorksheetEntries = {};
let workbook: ReturnType<typeof createSettlementWorksheet> | undefined;
let request = 0;
let activeVersion = "";
const filledOnly = ref(false);
const notice = ref("");
const selection = ref("");
const issues = shallowRef<QuantityIssue[]>([]);
const writableCount = computed(() => rows.value.filter(row => row.editable).length);
const filledCount = computed(() => Object.keys(entries.value).length);
const dark = computed(() => settings.resolvedTheme === ThemeMode.DARK);
const primary = () => getComputedStyle(document.documentElement).getPropertyValue("--el-color-primary").trim() || "#165dff";
watch([dark, () => settings.themeColors.primary], () => workbook?.theme(dark.value, primary()), { flush: "post" });
watch(filledOnly, value => workbook?.filterFilled(value));
watch(ready, value => emit("readiness-change", value), { immediate: true, flush: "sync" });

function initialEntries(positions: readonly WorkPosition[]) {
  const byScope = new Map(positions.filter(row => row.editable).map(row =>
    [row.project_scope_id + "|" + row.location_item_no, row.id]));
  const mapped: Record<string, WorksheetEntries[string]> = {};
  for (const resolution of props.resolutions) {
    const id = byScope.get(resolution.project_scope_id + "|" + resolution.location_item_no);
    if (!id) continue;
    mapped[id] = { quantity: formatScaledDecimal(resolution.resolved_quantity_scaled, 4), evidence: resolution.evidence ?? "" };
  }
  return mapped;
}

function changed() {
  const current = entries.value;
  return workbook?.isEditing() || Object.keys(current).length !== Object.keys(original).length ||
    Object.entries(current).some(([id, value]) =>
      original[id]?.quantity !== value.quantity || original[id]?.evidence !== value.evidence);
}

function fetchPositions(approvalId: string) {
  const query = new URLSearchParams({ approval_version_id: approvalId });
  if (props.settlementId) query.set("settlement_id", props.settlementId);
  return settlementWorksheet(props.projectId, query);
}

function affectedEntries(target: readonly WorkPosition[]) {
  const currentById = new Map(rows.value.map(row => [row.id, row]));
  const nextById = new Map(target.filter(row => row.editable).map(row => [row.id, row]));
  return Object.keys(entries.value).flatMap(id => {
    const previous = currentById.get(id);
    const next = nextById.get(id);
    if (!previous) return [{ id, message: "原批准位置已无法读取" }];
    let reason = "";
    if (!next) reason = "不在目标批准版本";
    else if (previous.unit_id !== next.unit_id || previous.unit_version !== next.unit_version || previous.precision !== next.precision)
      reason = "冻结单位或精度变化";
    else if (previous.approved_quantity_scaled !== next.approved_quantity_scaled)
      reason = "批准数量发生变化";
    return reason ? [{ id, message: "需求 "+previous.demand_no+" 的作业位置 "+previous.location_label+"："+reason }] : [];
  });
}

async function load() {
  const sequence = ++request;
  const version = props.approvalId;
  ready.value = false;
  loading.value = true;
  error.value = "";
  try {
    const [{ rows: positions }, { createSettlementWorksheet: create }] = await Promise.all([
      fetchPositions(version), import("./settlement-worksheet"),
    ]);
    if (sequence !== request) return;

    if (!activeVersion) {
      original = initialEntries(positions);
      entries.value = original;
    } else if (activeVersion !== version) {
      const excluded = new Set(affectedEntries(positions).map(row => row.id));
      entries.value = Object.fromEntries(Object.entries(entries.value).filter(([id]) => !excluded.has(id)));
    }

    workbook?.dispose();
    workbook = undefined;
    rows.value = positions;
    activeVersion = version;
    filledOnly.value = false;
    issues.value = [];
    notice.value = "";
    selection.value = "";

    if (positions.length) {
      await nextTick();
      if (sequence !== request || !host.value) return;
      workbook = create({
        host: host.value, rows: positions, initial: entries.value, dark: dark.value, primary: primary(),
        onChange: value => { if (sequence === request) entries.value = value; },
        onSelection: value => { if (sequence === request) selection.value = value; },
        onNotice: value => { if (sequence === request) notice.value = value; },
        onValidation: value => { if (sequence === request) issues.value = value; },
      });
      await workbook.ready;
    }
    if (sequence === request) ready.value = true;
  } catch (cause) {
    if (sequence !== request) return;
    error.value = (cause as Error).message;
  } finally {
    if (sequence === request) loading.value = false;
  }
}

watch(() => props.approvalId, () => { void load(); }, { immediate: true });
onBeforeUnmount(() => {
  request++;
  workbook?.dispose();
});

async function previewSwitch(version: string) {
  await workbook?.finishEditing();
  const target = await fetchPositions(version);
  return affectedEntries(target.rows).map(row => row.message);
}

async function prepareSave() {
  if (!ready.value || activeVersion !== props.approvalId) return null;
  if (!rows.value.length) return { resolutions: [] };
  const result = await workbook?.prepareSave();
  if (!result && issues.value.length) {
    await nextTick();
    validationPanel.value?.scrollIntoView({ block: "nearest" });
  }
  return result ?? null;
}

defineExpose({ finishEditing: () => workbook?.finishEditing(), changed, prepareSave, previewSwitch });
</script>

<template>
  <section class="settlement-worksheet" aria-label="本次完成工作量工作表">
    <WorksheetViewport v-slot="{ expanded, toggle }" name="本次完成工作量" :available="ready && rows.length > 0"
      :finish-editing="() => workbook?.finishEditing()" :focus-worksheet="() => workbook?.focusKeyboard()">
    <div class="settlement-work-heading">
      <div>
        <h3>本次完成工作量</h3>
        <p>按 Enter 连续录入，支持拖拽填充和 Excel 粘贴。保存时校验数量。</p>
      </div>
      <div class="settlement-work-actions">
        <ElCheckbox v-model="filledOnly" :disabled="!ready || !rows.length || (!filledOnly && !filledCount)">只看已填写</ElCheckbox>
        <ElButton :disabled="!ready || !rows.length" data-guide-action="finance.resolution-remove" @click="workbook?.undo()">撤销</ElButton>
        <ElButton :disabled="!ready || !rows.length" @click="workbook?.redo()">重做</ElButton>
        <ElButton :disabled="!ready || !rows.length" @click="filledOnly=false;workbook?.clearFilters()">清除筛选</ElButton>
        <ElButton type="primary" plain :disabled="!ready || !rows.length" @click="workbook?.remaining()">按余量填充</ElButton>
        <ElButton v-if="rows.length" :disabled="!ready && !expanded" :aria-pressed="expanded"
          @mousedown.prevent @click="toggle">{{ expanded ? "退出全屏" : "全屏编辑" }}</ElButton>
      </div>
    </div>
    <ElAlert v-if="error" type="error" title="工作量位置读取失败" :description="error" :closable="false">
      <ElButton :loading="loading" @click="load">重新读取位置</ElButton>
    </ElAlert>
    <ElSkeleton v-if="loading && !rows.length && !error" :rows="3" animated />
    <ElEmpty v-else-if="!loading && !error && !rows.length" description="本项目当前没有可列出的作业位置" />
    <div v-show="rows.length && !error" class="settlement-work-frame" :aria-busy="loading" :inert="loading">
      <div class="settlement-work-caption">
        <span data-testid="settlement-filled-count">已录入 <strong>{{ filledCount }}</strong> / {{ writableCount }} 处</span>
        <span class="settlement-work-legend"><i></i>可填写</span>
        <span class="settlement-work-legend"><i class="readonly"></i>只读</span>
        <span class="settlement-work-legend"><i class="excess"></i>超出批准余量（禁止保存）</span>
      </div>
      <div v-if="issues.length" ref="validationPanel" class="settlement-work-validation" role="alert">
        <strong>请修正 {{ issues.length }} 个数量单元格后保存</strong>
        <ul>
          <li v-for="item in issues" :key="item.cell">
            <ElButton link type="danger" @click="workbook?.focusQuantity(item.row, true)">{{ item.cell }}（{{ item.location }}）</ElButton>
            <span>{{ item.message }}</span>
          </li>
        </ul>
      </div>
      <div ref="host" class="settlement-work-canvas" role="region" aria-label="结算工作表"
        data-guide-action="finance.resolution-add" :data-ready="ready"
        :style="{ '--worksheet-height': (Math.min(rows.length, 11) * 34 + 80) + 'px' }" @wheel.prevent></div>
      <div class="settlement-work-status" aria-live="polite">{{ notice || selection || "选中单元格开始录入" }}</div>
    </div>
    </WorksheetViewport>
  </section>
</template>

<style scoped>
.settlement-worksheet { min-width: 0; margin: 20px 0 0; }
.settlement-work-heading, .settlement-work-actions, .settlement-work-caption {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.settlement-work-heading { justify-content: space-between; margin-bottom: 12px; }
.settlement-work-heading h3 { margin: 0; font-size: 16px; font-weight: 600; }
.settlement-work-heading p { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.settlement-work-actions .el-button + .el-button { margin-left: 0; }
.settlement-work-frame { border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; }
.settlement-work-caption, .settlement-work-status {
  background: var(--surface-subtle);
  color: var(--el-text-color-regular);
  font-size: 12px;
  padding: 8px 12px;
}
.settlement-work-caption { gap: 12px; border-bottom: 1px solid var(--card-border); }
.settlement-work-caption > :first-child { margin-right: auto; }
.settlement-work-status { border-top: 1px solid var(--card-border); }
.settlement-work-legend { display: inline-flex; align-items: center; gap: 4px; }
.settlement-work-legend i { width: 10px; height: 10px; border: 1px solid var(--card-border); border-radius: 2px; background: var(--content-bg); }
.settlement-work-legend .readonly { background: var(--el-fill-color); }
.settlement-work-legend .excess { background: var(--el-color-danger-light-8); }
.settlement-work-canvas {
  position: relative;
  min-width: 0;
  height: min(var(--worksheet-height), max(205px, calc(100vh - 365px)));
}
/* The SDK's hidden input needs a nonzero box for the browser to dispatch beforeinput. */
.settlement-work-canvas :deep([contenteditable][data-u-comp="editor"]) {
  min-width: 1px;
  min-height: 1px;
}
.settlement-work-validation {
  max-height: 112px;
  overflow: auto;
  padding: 8px 12px;
  background: var(--el-color-danger-light-9);
  border-bottom: 1px solid var(--el-color-danger-light-7);
  font-size: 13px;
}
.settlement-work-validation ul { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; margin: 4px 0 0; padding: 0; }
.settlement-work-validation li { display: flex; align-items: baseline; gap: 4px; }
.settlement-work-validation .el-button { font-weight: 600; }
</style>
