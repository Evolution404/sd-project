<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { ThemeMode } from "@/enums";
import { useSettingsStore } from "@/stores/settings";
import type { createBusinessWorksheet, WorksheetColumn, WorksheetRow, WorksheetValues, WorksheetIssue } from "./univer-engine";

const props = defineProps<{
  name: string; rows: readonly WorksheetRow[]; columns: readonly WorksheetColumn[];
  validate: (values: WorksheetValues) => WorksheetIssue[]; disabled?: boolean;
  sessionKey: string; visibleRow?: (row: WorksheetRow) => boolean; undoGuide?: string; redoGuide?: string; removable?: boolean; removeGuide?: string; removeLabel?: string;
}>();
const emit = defineEmits<{ change: [values: WorksheetValues]; "readiness-change": [ready: boolean]; "rows-change": [rows: readonly WorksheetRow[]] }>();
const settings = useSettingsStore();
const host = ref<HTMLElement>(), panel = ref<HTMLElement>();
const activeCanvas = ref(false);
const ready = ref(false), failure = ref(""), notice = ref(""), selection = ref("");
const canUndo = ref(false), canRedo = ref(false);
const visibleCount=ref(0);
const issues = shallowRef<WorksheetIssue[]>([]);
const current = shallowRef<WorksheetValues>({});
let baseline: WorksheetValues = {};
let engine: ReturnType<typeof createBusinessWorksheet> | undefined;
let generation = 0;
let pendingLoad: Promise<void>;
const dark = computed(() => settings.resolvedTheme === ThemeMode.DARK);
const primary = () => getComputedStyle(document.documentElement).getPropertyValue("--el-color-primary").trim() || "#165dff";
const changed = computed(() => Object.keys(current.value).length !== Object.keys(baseline).length ||
  Object.entries(current.value).some(([id, fields]) => !baseline[id] ||
    props.columns.some(column => column.editable && (fields[column.key] ?? "") !== (baseline[id][column.key] ?? ""))));
watch([dark, () => settings.themeColors.primary], () => engine?.theme(dark.value, primary()), { flush: "post" });
watch(ready, value => emit("readiness-change", value), { immediate: true, flush: "sync" });
watch(() => props.visibleRow, value => { if (ready.value) engine?.setRowVisibility(value); });

async function load(empty = false) {
  const token = ++generation;
  const started = performance.now();
  ready.value = false; engine?.dispose(); engine = undefined;
  issues.value = []; failure.value = ""; notice.value = ""; selection.value = ""; canUndo.value = false; canRedo.value = false;
  const rows = props.rows.slice();
  const columns = props.columns.map(column => ({ ...column }));
  baseline = Object.fromEntries(rows.map(row => [row.id, { ...row.values }])); current.value = baseline;
  activeCanvas.value = rows.length > 0 || empty;
  if (!activeCanvas.value) { ready.value = true; return; }
  const snapshotReady = performance.now();
  try {
    const { createBusinessWorksheet: create } = await import("./univer-engine");
    const moduleReady = performance.now();
    await nextTick();
    if (token !== generation || !host.value) return;
    const createStart = performance.now();
    engine = create({
      host: host.value, rows, columns, name: props.name, dark: dark.value, primary: primary(),
      filled: values => columns.some(column => column.editable && Boolean(values[column.key])),
      validate: values => props.validate(values),
      onRowsChange: props.removable ? draft => { if (token === generation) emit("rows-change", draft); } : undefined,
      removalLabel: props.removeLabel ?? "移除选中位置", visibleRow: props.visibleRow,
      onChange: values => { if (token === generation) { current.value = values; emit("change", values); } },
      onSelection: value => { if (token === generation) selection.value = value; },
      onNotice: value => { if (token === generation) notice.value = value; },
      onValidation: value => { if (token === generation) issues.value = value; },
      onVisibleCount:count=>{if(token===generation)visibleCount.value=count;},
      onHistory: value => { if (token === generation) { canUndo.value = value.undos > 0; canRedo.value = value.redos > 0; } },
    });
    const created = performance.now();
    await engine.ready;
    if (token === generation) {
      host.value.dataset.loadMetrics = JSON.stringify({
        rows: rows.length, columns: columns.length,
        snapshotMs: Math.round(snapshotReady-started),
        importMs: Math.round(moduleReady-snapshotReady),
        createMs: Math.round(created-createStart),
        readinessMs: Math.round(performance.now()-created),
        totalMs: Math.round(performance.now()-started),
      });
      engine.setRowVisibility(props.visibleRow);
      ready.value = true;
    }
  } catch (cause) {
    if (token !== generation) return;
    engine?.dispose(); engine = undefined; failure.value = (cause as Error).message;
  }
}
function startLoad() {
  pendingLoad = load();
}
watch(() => props.sessionKey, startLoad, { immediate: true });
onBeforeUnmount(() => { generation++; engine?.dispose(); });
async function prepareSave() {
  if (!props.rows.length) return {};
  if (!ready.value) {
    if (failure.value) return null;
    // A hidden/unopened tab cannot receive edits. Validate its exact input snapshot
    // instead of requiring the canvas renderer to have acquired a visible size.
    const snapshot:WorksheetValues=Object.fromEntries(props.rows.map(row=>[row.id,{...row.values}]));
    const errors=props.validate(snapshot);
    issues.value=errors;
    if(errors.length)return null;
    return snapshot;
  }
  const values = await engine?.prepareSave();
  if (!values && issues.value.length) { await nextTick(); panel.value?.scrollIntoView({ block: "nearest" }); }
  return values ?? null;
}
async function addRows(rows: readonly WorksheetRow[]) {
  if (props.disabled || !props.removable) return false;
  if (!engine && !props.rows.length && ready.value) pendingLoad = load(true);
  const token = generation;
  await pendingLoad;
  if (token !== generation || !ready.value || props.disabled || !engine) return false;
  return engine.addRows(rows);
}
defineExpose({ prepareSave, addRows, focusField: (id: string, field: string) => engine?.focusField(id, field), selectedRowIds:()=>engine?.selectedRowIds()??[], finishEditing: () => engine?.finishEditing(),
  changed: () => changed.value || Boolean(engine?.isEditing()), undo: () => engine?.undo(), redo: () => engine?.redo() });
</script>
<template>
  <section class="business-worksheet" :aria-label="name">
    <ElAlert v-if="failure" type="error" :title="name + '加载失败'" :description="failure" :closable="false">
      <ElButton @click="startLoad">重新加载</ElButton>
    </ElAlert>
    <ElEmpty v-else-if="!rows.length && !removable" description="暂无明细" />
    <div v-else data-guide-action="common.draft-grid" class="worksheet-frame" :aria-busy="!ready">
      <div class="worksheet-toolbar">
        <span>共 {{ rows.length }} 行</span><span>显示 {{visibleCount}} 行</span><span>{{ changed ? "有未保存修改" : "未修改" }}</span>
        <ElButton :data-guide-action="undoGuide" :disabled="!ready || disabled || !canUndo" @click="engine?.undo()">撤销</ElButton>
        <ElButton :data-guide-action="redoGuide" :disabled="!ready || disabled || !canRedo" @click="engine?.redo()">重做</ElButton>
        <ElButton :disabled="!ready || disabled" @click="engine?.clearFilters()">清除筛选</ElButton>
        <ElButton v-if="removable" :data-guide-action="removeGuide" type="danger" plain :disabled="!ready || disabled" @click="engine?.removeSelectedRows()">{{ removeLabel ?? "移除选中位置" }}</ElButton>
        <slot name="toolbar" />
        <span>可填写</span><span>灰底只读</span><span>红底错误</span>
      </div>
      <div v-if="issues.length" ref="panel" class="worksheet-validation" role="alert">
        <strong>请修正 {{ issues.length }} 个单元格后保存</strong>
        <div v-for="issue in issues" :key="issue.rowId + ':' + issue.field">
          <ElButton link type="danger" @click="engine?.focusCell(issue.row, issue.column, true)">{{ issue.cell }}（{{ issue.location }}）</ElButton>
          {{ issue.message }}
        </div>
      </div>
      <ElEmpty v-if="!activeCanvas" description="暂无明细" :image-size="48" />
      <div v-show="activeCanvas" ref="host" class="worksheet-canvas" role="region" :aria-label="name + '工作表'" :data-ready="ready"
        :inert="!ready || disabled" :style="{ '--worksheet-height': (Math.min(rows.length, 14) * 34 + 80) + 'px' }" @wheel.prevent />
      <div v-if="activeCanvas" class="worksheet-status" aria-live="polite">{{ !ready ? "正在加载工作表…" : notice || selection || "选中单元格开始录入" }}</div>
    </div>
  </section>
</template>
<style scoped>
.business-worksheet { min-width: 0; }
.worksheet-frame { border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; }
.worksheet-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.worksheet-toolbar > :first-child { margin-right: auto; }
.worksheet-toolbar .el-button + .el-button { margin-left: 0; }
.worksheet-toolbar, .worksheet-status { padding: 8px 12px; background: var(--surface-subtle); color: var(--el-text-color-regular); font-size: 12px; }
.worksheet-canvas { position: relative; min-width: 0; height: min(var(--worksheet-height), max(205px, calc(100vh - 300px))); }
.worksheet-canvas :deep([contenteditable][data-u-comp="editor"]) { min-width: 1px; min-height: 1px; }
.worksheet-validation { max-height: 130px; overflow: auto; padding: 8px 12px; background: var(--el-color-danger-light-9); font-size: 13px; }
</style>
