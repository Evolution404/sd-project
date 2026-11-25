<template>
  <ElCard shadow="never">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
      <h2 class="text-lg font-semibold">{{ mode === "create" ? "批量新增子项目" : "批量修订子项目档案" }}</h2>
      <div class="page-heading-actions flex flex-wrap gap-2">
        <ElButton :disabled="busy" @click="cancel">返回子项目列表</ElButton>
        <ElButton :disabled="busy || !categoryReady || !rows.length" @click="preflight">预检档案</ElButton>
        <ElButton type="primary" :disabled="busy || !pending" @click="submit">整批保存档案</ElButton>
      </div>
    </div>
    <ElForm v-if="mode === 'create'" class="business-control-row mb-3" novalidate :disabled="busy">
      <ElButton @click="frameworkPicker = true">选择年度框架</ElButton>
      <ElText v-if="framework">{{ framework.name }}</ElText>
      <ElFormItem label="执行协议" class="mb-0" label-position="left">
        <ProjectAgreementField :framework-id="framework?.id" v-model="agreement" />
      </ElFormItem>
      <ElFormItem label="新增行数" class="mb-0" label-position="left">
        <ElInputNumber v-model="newRows" :min="1" :max="Math.max(1, MAX_PROJECT_PROFILE_BATCH - rows.length)" :precision="0" />
      </ElFormItem>
      <ElButton type="primary" :disabled="!framework || adding || !categoryReady" @click="addRows">新增档案行</ElButton>
    </ElForm>
    <ElAlert v-if="error" type="error" :title="error" :closable="false" class="mb-3" />
    <ElSkeleton v-if="categoryLoading" :rows="5" animated />
    <ElButton v-else-if="!categoryReady" @click="loadCategories">重新加载项目分类</ElButton>
    <BusinessWorksheet v-else ref="sheet" name="子项目档案" session-key="project-profiles"
      :rows="rows" :columns="columns" :validate="validate" :disabled="busy"
      :removable="mode === 'create'" remove-label="移除选中档案"
      @change="values => draft = values" @rows-change="value => rows = value" />
    <ElAlert v-if="preview" class="mt-3" :type="preview.issues.length ? 'warning' : 'success'"
      :title="`已预检 ${preview.count} 条档案，问题 ${preview.issues.length} 项`" :closable="false" />
    <ElTable v-if="preview?.issues.length" :data="preview.issues" max-height="240" class="mt-3" border>
      <ElTableColumn label="档案行" width="140">
        <template #default="{ row }">
          <ElButton link type="primary" @click="focusIssue(String(row.ref), String(row.field || 'name'))">{{ row.ref }}</ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn label="问题" prop="message" />
    </ElTable>
    <NativeRecordPicker v-if="frameworkPicker" title="选择批量新增的年度框架" placeholder="搜索框架名称"
      confirm-label="选用年度框架" :columns="frameworkColumns" :loader="loadFrameworks" single
      @close="frameworkPicker = false" @confirm="chooseFramework" />
  </ElCard>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watchEffect } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { listRouteIdentity } from "@/components/Crud/utils/list-state";
import { ElMessage, ElMessageBox } from "element-plus";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import NativeRecordPicker from "@/components/business/NativeRecordPicker.vue";
import ProjectAgreementField from "@/components/business/ProjectAgreementField.vue";
import { fenToYuan, listFunding, yuanToFen, type FundingRow } from "@/api/business/funding";
import { listDictionaries, type DictionaryRow } from "@/api/business/dictionaries";
import { commitProjectProfiles, eligibleProjectAgreements, previewProjectProfiles, type ProjectRow } from "@/api/business/projects";
import { randomRequestId } from "@/utils/business/request-id";
import { MAX_PROJECT_PROFILE_BATCH, type ProjectManagementInput, type ProjectProfileBatchPreview, type ProjectProfileBatchRow } from "../../../../server/shared/types/projects";

const props = defineProps<{ mode: "create" | "update"; records: ProjectRow[] }>();
const emit = defineEmits<{ cancel: []; saved: [] }>();
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const selected = new Map(props.records.map(row => [row.id, row]));
const fundingChoices = new WeakMap<WorksheetRow, Pick<ProjectManagementInput, "framework_id" | "agreement_id">>();
const framework = shallowRef<FundingRow>();
const agreement = ref<string | null>(null);
const frameworkPicker = ref(false);
const categories = shallowRef<DictionaryRow[]>([]);
const categoryReady = ref(false), categoryLoading = ref(true);
const busy = ref(false), adding = ref(false);
const newRows = ref<number | undefined>(1);
const error = ref("");
const draft = shallowRef<WorksheetValues>({});
const preview = shallowRef<ProjectProfileBatchPreview>();
const pending = shallowRef<{ signature: string; fingerprint: string; requestKey: string }>();
let sequence = 0;
let active = true;
const columns = computed<WorksheetColumn[]>(() => [
  { key: "code", title: props.mode === "create" ? "档案行" : "项目编号", width: 146 },
  { key: "name", title: "项目名称", width: 250, editable: true, required: true },
  { key: "planned_start_on", title: "计划开始", width: 145, editable: true },
  { key: "planned_end_on", title: "计划结束", width: 145, editable: true },
  { key: "estimate", title: "初步估算（元）", width: 155, editable: true, numeric: true },
  { key: "preliminary_estimate_basis", title: "估算依据", width: 250, editable: true },
  { key: "reason", title: "说明", width: 180, editable: true },
  { key: "category", title: "项目分类", width: 150, editable: true, options: categories.value.map(row => row.name) },
  ...(props.mode === "create" ? [
    { key: "framework", title: "年度框架", width: 170 }, { key: "agreement", title: "执行协议", width: 170 },
  ] : []),
]);
const rows = shallowRef<readonly WorksheetRow[]>(props.records.map(row => ({
  id: row.id, label: row.code, values: {
    code: row.code, name: row.name, planned_start_on: row.planned_start_on || "", planned_end_on: row.planned_end_on || "",
    estimate: row.preliminary_estimate_fen == null ? "" : fenToYuan(row.preliminary_estimate_fen),
    preliminary_estimate_basis: row.preliminary_estimate_basis || "", reason: "", category: row.category_name || "",
  },
})));
const frameworkColumns: { key: keyof FundingRow; label: string; width?: number }[] = [
  { key: "name", label: "年度框架名称", width: 250 }, { key: "fiscal_year", label: "年度", width: 100 },
  { key: "code", label: "框架编号" },
];

async function loadCategories() {
  categoryLoading.value = true;
  error.value = "";
  try {
    const size = 200;
    const first = await listDictionaries("categories", { size });
    const available = first.items.slice();
    for (let page = 2; page <= Math.ceil(first.total / size); page++) {
      available.push(...(await listDictionaries("categories", { page, size })).items);
    }
    if (!active) return;
    categories.value = available.filter(row => row.status === "active" && !row.deleted);
    categoryReady.value = true;
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    categoryLoading.value = false;
  }
}
void loadCategories();

function loadFrameworks(keyword: string, page: number) {
  return listFunding("frameworks", { keyword, page, size: 20, status: "active" });
}
function chooseFramework(selection: FundingRow[]) {
  const chosen = selection[0];
  if (!chosen) return;
  if (framework.value?.id !== chosen.id) agreement.value = null;
  framework.value = chosen;
  frameworkPicker.value = false;
}
async function addRows() {
  if (busy.value || adding.value || !framework.value) return;
  const count = newRows.value;
  if (!count || !Number.isSafeInteger(count) || count < 1 || count + rows.value.length > MAX_PROJECT_PROFILE_BATCH) {
    error.value = "请填写新增行数。一批最多" + MAX_PROJECT_PROFILE_BATCH + "条档案";
    return;
  }
  adding.value = true;
  error.value = "";
  try {
    const adopted = framework.value;
    const agreementId = agreement.value;
    const option = agreementId ? (await eligibleProjectAgreements(adopted.id, agreementId)).options.find(row => row.id === agreementId && row.eligible) : undefined;
    if (agreementId && !option) throw Error("执行协议已发生变化，请重新选择");
    if (!active) return;
    const additions = Array.from({ length: count }, (): WorksheetRow => {
      const code = String(++sequence);
      const row: WorksheetRow = {
        id: code, label: code,
        values: { code, framework: adopted.name, agreement: option?.name ?? "", name: "", estimate: "" },
      };
      fundingChoices.set(row, { framework_id: adopted.id, agreement_id: agreementId });
      return row;
    });
    if (!await sheet.value?.addRows(additions)) throw Error("档案工作表未就绪");
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    adding.value = false;
  }
}
function validate(values: WorksheetValues): WorksheetIssue[] {
  const issues: WorksheetIssue[] = [];
  for (const [index, row] of rows.value.entries()) {
    const fields = values[row.id] ?? row.values;
    if (!fields.name?.trim()) issues.push({ row: index + 1, column: 1, cell: "B" + (index + 2),
      rowId: row.id, field: "name", location: row.label, message: "请填写项目名称" });
    if (fields.category && fields.category !== row.values.category &&
      categories.value.filter(category => category.name === fields.category).length !== 1) {
      issues.push({ row: index + 1, column: 7, cell: "H" + (index + 2),
        rowId: row.id, field: "category", location: row.label, message: "请选择名称唯一且在用的项目分类" });
    }
    if (!fields.estimate) continue;
    try { yuanToFen(fields.estimate); }
    catch (failure) {
      issues.push({ row: index + 1, column: 4, cell: "E" + (index + 2),
        rowId: row.id, field: "estimate", location: row.label, message: (failure as Error).message });
    }
  }
  return issues;
}
function changed(row: WorksheetRow, values: WorksheetValues) {
  const current = values[row.id];
  return Boolean(current && columns.value.some(column => column.editable && (current[column.key] ?? "") !== (row.values[column.key] ?? "")));
}
function collect(values: WorksheetValues): ProjectProfileBatchRow[] {
  return rows.value.flatMap(row => {
    if (props.mode === "update" && !changed(row, values)) return [];
    const fields = values[row.id] ?? row.values;
    const previous = selected.get(row.id);
    const result: ProjectManagementInput = {
      name: fields.name ?? "",
      planned_start_on: fields.planned_start_on || null, planned_end_on: fields.planned_end_on || null,
      preliminary_estimate_fen: fields.estimate ? yuanToFen(fields.estimate) : null,
      preliminary_estimate_basis: fields.preliminary_estimate_basis || null,
      reason: fields.reason || "",
      ...(previous ? { expected_version: previous.profile_version, expected_funding_version: previous.funding?.version_no ?? 0 } : fundingChoices.get(row)),
    };
    if ((fields.category ?? "") !== (row.values.category ?? "")) {
      result.category_id = categories.value.find(category => category.name === fields.category)?.id ?? null;
    }
    return [{ ref: row.label, ...previous && { id: previous.id }, values: result }];
  });
}
function focusIssue(ref: string, field: string) {
  const row = rows.value.find(row => row.label === ref);
  if (row) sheet.value?.focusField(row.id, field === "preliminary_estimate_fen" ? "estimate" : field === "category_id" ? "category" : field);
}
function signature() {
  return JSON.stringify(rows.value.map(row => [row.id, draft.value[row.id]]));
}
watchEffect(() => { if (pending.value && signature() !== pending.value.signature) pending.value = undefined; });

async function preflight() {
  if (busy.value || adding.value) return;
  busy.value = true;
  preview.value = undefined;
  pending.value = undefined;
  error.value = "";
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const input = collect(values);
    if (!input.length) { ElMessage.info("没有需要保存的档案修改"); return; }
    const result = await previewProjectProfiles(input);
    preview.value = result;
    if (result.fingerprint) pending.value = { signature: signature(), fingerprint: result.fingerprint, requestKey: randomRequestId() };
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    busy.value = false;
  }
}
async function submit() {
  const target = pending.value;
  if (!target || busy.value) return;
  busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    if (signature() !== target.signature) throw Error("档案内容已修改，请重新预检");
    const input = collect(values);
    await ElMessageBox.confirm("提交后将整批保存正式项目档案。", "批量保存档案",
      { type: "warning", confirmButtonText: "确认保存", cancelButtonText: "继续编辑" });
    const result = await commitProjectProfiles(input, target.fingerprint, target.requestKey);
    ElMessage.success("已保存 " + result.results.length + " 条项目档案");
    emit("saved");
  } catch (failure) {
    if (failure !== "cancel" && failure !== "close") error.value = (failure as Error).message;
  } finally {
    busy.value = false;
  }
}
const dirty = computed(() => props.mode === "create" ? rows.value.length > 0 : rows.value.some(row => changed(row, draft.value)));
async function canLeave() {
  if (busy.value || adding.value) return false;
  await sheet.value?.finishEditing();
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm("档案工作表有未保存修改，确定离开？", "退出档案批量录入",
      { type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续编辑" });
    return true;
  } catch { return false; }
}
function protectRefresh(event: BeforeUnloadEvent) {
  if (dirty.value || sheet.value?.changed() || busy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
async function cancel() { if (await canLeave()) emit("cancel"); }
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate((to, from) => listRouteIdentity(to.fullPath) === listRouteIdentity(from.fullPath) || canLeave());
window.addEventListener("beforeunload", protectRefresh);
onBeforeUnmount(() => { active = false; window.removeEventListener("beforeunload", protectRefresh); });
</script>
