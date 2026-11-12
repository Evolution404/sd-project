<script setup lang="ts">
import { newClientId } from "../../../shared/utils/id";
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import type {
  DemandRecord,
  DemandWriteInput,
} from "../../../../../server/shared/types/demands";
import type {
  OperationRecord,
  OperationVersion,
} from "../../../../../server/shared/types/work-standards";
import type {
  OperationAttribute,
  AttributeValues,
} from "../../../../../server/shared/types/operation-attributes";
import type { DemandDraft, LocationDraft } from "../types/demand";
import { normalizeAttributeValues } from "../../../../../server/shared/operation-attributes";
import { api } from "../../../shared/api/client";
import {
  readAdoptedQuantityPrecision,
  readCurrentMaterialPrecision,
} from "../../../shared/api/quantity-precision";
import { useAccess } from "../../../shared/composables/use-access";
import { useDialogDraftGuard } from "../../../shared/forms/use-dialog-draft";
import { parkDemandDraft } from "../../../shared/forms/demand-draft-handoff";
import AttributeFields from "../../../shared/ui/AttributeFields.vue";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import DemandLocationPicker from "./DemandLocationPicker.vue";
import DemandLocationTable from "./DemandLocationTable.vue";
import DemandMaterialTable from "./DemandMaterialTable.vue";
const props = defineProps<{
  open: boolean;
  editing: DemandRecord | null;
  restored?: Record<string, unknown> | null;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [id: string];
  configure: [];
}>();
const reviewStandard = ref(false);
const can = useAccess(),
  formRef = ref<FormInstance>(),
  section = ref("basic"),
  scroll = ref<HTMLElement>();
const empty = (): DemandDraft => ({
  operation_id: "",
  problem_description: "",
  completion_standard: "",
  target_object: "",
  attributes: {},
  work_locations: [],
  materials: [],
  sources: [{ row_id: newClientId(), description: "" }],
});
const draft = ref<DemandDraft>(empty()),
  operation = ref<OperationRecord | null>(null),
  latestOperation = ref<OperationRecord | null>(null),
  loading = ref(false),
  loadError = ref(""),
  precision = ref<number>(),
  errors = ref<Record<string, unknown>>({}),
  invalid = ref<Record<string, boolean>>({}),
  picker = ref(false),
  setupMissing = ref(false);
const schema = computed<OperationAttribute[]>(() =>
  JSON.parse(operation.value?.attributes_schema_json || "[]"),
);
const guard = useDialogDraftGuard(() => draft.value);
let sequence = 0;
const draftKey = computed(
  () => "sd-demand-draft:" + (props.editing?.id || "new"),
);
let initialized = false;
watch(
  draft,
  (value) => {
    if (initialized && props.open)
      sessionStorage.setItem(draftKey.value, JSON.stringify(value));
  },
  { deep: true },
);
async function adopt(row: OperationRecord) {
  const seq = ++sequence;
  operation.value = row;
  precision.value = undefined;
  loadError.value = "";
  try {
    const value = await readAdoptedQuantityPrecision(
      row.default_unit_id,
      row.default_unit_version,
    );
    if (seq === sequence) precision.value = value;
  } catch (failure) {
    if (seq === sequence)
      loadError.value =
        "正式计量单位版本读取失败：" + (failure as Error).message;
  }
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    initialized = false;
    errors.value = {};
    invalid.value = {};
    section.value = "basic";
    operation.value = null;
    loadError.value = "";
    draft.value = props.restored ? JSON.parse(JSON.stringify(props.restored)) as DemandDraft : empty();
    try {
      setupMissing.value = !(
        await api<{ total: number }>("/catalog/operations?page_size=1")
      ).total;
      const item = props.editing;
      if (item) {
        draft.value = {
          operation_id: item.operation_id,
          operation_version: item.operation_version,
          problem_description: item.problem_description,
          completion_standard: item.completion_standard,
          target_object: item.target_object,
          priority_id: item.priority_id,
          expected_on: item.expected_on,
          attributes: { ...item.attributes },
          work_locations: item.work_locations.map((row) => ({
            ...row,
            id: newClientId(),
            attributes: { ...row.attributes },
            line_name: row.location_snapshot_json.line_name,
            label: row.location_snapshot_json.location_label,
          })),
          materials: [],
          sources: item.sources.map((source) => ({
            ...source,
            row_id: source.id,
          })),
        };
        for (const material of item.materials) {
          let materialPrecision: number | undefined, error: string | undefined;
          try {
            materialPrecision = await readCurrentMaterialPrecision(
              material.material_id,
            );
          } catch (failure) {
            error = (failure as Error).message;
          }
          draft.value.materials.push({
            id: newClientId(),
            material_id: material.material_id,
            quantity_scaled: material.quantity_scaled,
            note: material.note,
            name: material.material_name,
            model: material.model,
            specification: material.specification,
            unit: material.unit_snapshot,
            precision: materialPrecision,
            error,
          });
        }
      }
      const stored = JSON.parse(
        sessionStorage.getItem(draftKey.value) || "null",
      );
      if (props.restored)
        draft.value = props.restored as unknown as DemandDraft;
      if (stored && !props.restored) {
        try {
          await ElMessageBox.confirm(
            "发现尚未保存的需求草稿，是否恢复？",
            "恢复草稿",
            {
              confirmButtonText: "恢复草稿",
              cancelButtonText: "使用当前正式内容",
            },
          );
          draft.value = stored as DemandDraft;
        } catch {}
      }
      if (draft.value.operation_id) {
        const current = await api<OperationRecord>(
          "/catalog/operations/" + draft.value.operation_id + "?deleted=true",
        );
        latestOperation.value = current;
        if (
          draft.value.operation_version &&
          draft.value.operation_version !== current.version
        ) {
          const history = await api<{ versions: OperationVersion[] }>(
            "/catalog/operations/" + current.id + "?history=true",
          );
          const frozen = history.versions.find(
            (version) => version.version === draft.value.operation_version,
          );
          if (!frozen) throw Error("采用的操作类型正式版本不存在");
          await adopt({ ...current, ...frozen, id: current.id });
        } else await adopt(current);
      }
      await nextTick();
      guard.capture();
      initialized = true;
    } catch (failure) {
      loadError.value = (failure as Error).message;
    }
  },
);
function navigate(value: string) {
  section.value = value;
  scroll.value
    ?.querySelector("#demand-section-" + value)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}
function close(done?: () => void) {
  void guard.confirmClose(() => {
    initialized = false;
    sessionStorage.removeItem(draftKey.value);
    emit("update:open", false);
    done?.();
  });
}
async function changeOperation(value: unknown, allowSame = false) {
  const id = typeof value === "string" ? value : "";
  const original = operation.value;
  if (!id || (id === original?.id && !allowSame)) return;
  const seq = ++sequence;
  try {
    const next = await api<OperationRecord>("/catalog/operations/" + id);
    if (seq !== sequence) return;
    const definitions: OperationAttribute[] = JSON.parse(
      next.attributes_schema_json,
    );
    const incompatible = draft.value.work_locations.filter(
      (row) =>
        (row.location_kind === "physical_tower") !==
          (next.work_target_type === "physical") ||
        (row.location_kind === "span" ? !next.allow_span : !next.allow_tower),
    );
    const retired = Object.keys(draft.value.attributes).filter(
      (key) =>
        !definitions.some(
          (field) =>
            field.enabled && field.key === key && field.scope === "demand",
        ),
    );
    const hasLocationValues = draft.value.work_locations.some((row) =>
      Object.keys(row.attributes).some(
        (key) =>
          !definitions.some(
            (field) =>
              field.enabled && field.key === key && field.scope === "location",
          ),
      ),
    );
    if (
      original &&
      (allowSame ||
        incompatible.length ||
        retired.length ||
        hasLocationValues ||
        original.default_unit_id !== next.default_unit_id ||
        draft.value.completion_standard !== original.completion_standard)
    ) {
      await ElMessageBox.confirm(
        `切换后采用${next.name}。需重新选择${incompatible.length}处不适用位置，清理不适用属性，并按${next.default_unit_id_label}核对数量。手工填写的验收标准会保留。`,
        "核对操作类型变化",
        { confirmButtonText: "应用新定义", cancelButtonText: "保留原操作" },
      );
      if (seq !== sequence) return;
    }
    draft.value.work_locations = draft.value.work_locations.filter(
      (row) => !incompatible.includes(row),
    );
    const retain = (values: AttributeValues, scope: string) =>
      Object.fromEntries(
        Object.entries(values).filter(([key]) =>
          definitions.some(
            (field) =>
              field.enabled && field.key === key && field.scope === scope,
          ),
        ),
      );
    draft.value.attributes = retain(draft.value.attributes, "demand");
    for (const row of draft.value.work_locations)
      row.attributes = retain(row.attributes, "location");
    for (const field of definitions.filter(
      (field) =>
        field.scope === "demand" &&
        field.source === "manual" &&
        field.enabled &&
        field.default_value !== undefined,
    ))
      if (draft.value.attributes[field.key] === undefined)
        draft.value.attributes[field.key] = field.default_value!;
    if (
      !draft.value.completion_standard ||
      draft.value.completion_standard === original?.completion_standard
    )
      draft.value.completion_standard = next.completion_standard || "";
    if (
      !draft.value.target_object ||
      draft.value.target_object === original?.default_target_object
    )
      draft.value.target_object = next.default_target_object;
    reviewStandard.value =
      !!original &&
      !!draft.value.completion_standard &&
      draft.value.completion_standard !== next.completion_standard;
    draft.value.operation_id = id;
    draft.value.operation_version = next.version;
    await adopt(next);
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
function addSource() {
  draft.value.sources.push({ row_id: newClientId(), description: "" });
}
function configure() {
  parkDemandDraft({
    form: JSON.parse(JSON.stringify(draft.value)),
    lineIds: [],
  });
  emit("update:open", false);
  emit("configure");
}
function addLocations(rows: LocationDraft[]) {
  const identity = (row: LocationDraft) =>
    row.location_kind +
    "/" +
    (row.logical_tower_id || row.physical_tower_id || row.span_id);
  const used = new Set(draft.value.work_locations.map(identity));
  draft.value.work_locations.push(
    ...rows.filter((row) => {
      const key = identity(row);
      if (used.has(key)) return false;
      used.add(key);
      return true;
    }),
  );
}
async function save(duplicate?: string[]) {
  if (loading.value) return;
  errors.value = {};
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      navigate("basic");
      return;
    }
    if (!operation.value || precision.value === undefined || loadError.value)
      throw Error(loadError.value || "正式计量单位精度尚未加载完成");
    const rows = [...draft.value.work_locations, ...draft.value.materials];
    if (rows.some((row) => invalid.value[row.id]))
      throw Error("存在尚未更正的数量输入，请按字段提示修正后保存");
    if (draft.value.materials.some((row) => row.precision === undefined))
      throw Error("物资计量单位正式版本读取失败，请重新选择物资");
    normalizeAttributeValues(
      schema.value,
      "demand",
      draft.value.attributes,
      "attributes",
    );
    for (const [index, row] of draft.value.work_locations.entries())
      normalizeAttributeValues(
        schema.value.filter((field) => field.source === "manual"),
        "location",
        Object.fromEntries(
          Object.entries(row.attributes).filter(([key]) =>
            schema.value.some(
              (field) => field.key === key && field.source === "manual",
            ),
          ),
        ),
        "work_locations." + index + ".attributes",
      );
    loading.value = true;
    const input: DemandWriteInput = {
      ...draft.value,
      expected_version: props.editing?.current_version,
      work_locations: draft.value.work_locations.map(
        ({ id, label, line_name, ...row }) => row,
      ),
      materials: draft.value.materials.map((row) => ({
        material_id: row.material_id,
        quantity_scaled: row.quantity_scaled,
        note: row.note,
      })),
      sources: draft.value.sources
        .filter((row) => row.id || row.description)
        .map(({ row_id, ...row }) => row),
      ...(duplicate
        ? { duplicate_decision: "separate", duplicate_matches: duplicate }
        : {}),
    };
    const saved = await api<DemandRecord>(
      "/demands" + (props.editing ? "/" + props.editing.id : ""),
      "POST",
      input,
    );
    sessionStorage.removeItem(draftKey.value);
    initialized = false;
    emit("update:open", false);
    emit("saved", saved.id);
  } catch (failure) {
    const problem = failure as Error & { fields?: Record<string, unknown> };
    errors.value = Object.fromEntries(
      Object.entries(problem.fields || {}).map(([path, message]) => {
        const location = /^work_locations\.(\d+)\.(.+)$/.exec(path);
        const id = location
          ? draft.value.work_locations[Number(location[1])]?.id
          : undefined;
        return [
          id && location ? "work_locations." + id + "." + location[2] : path,
          message,
        ];
      }),
    );
    if (Array.isArray(errors.value.duplicates)) {
      try {
        await ElMessageBox.confirm(
          "与" +
            errors.value.duplicates.join("、") +
            "疑似重复，确认现场事实属于独立需求并分别保留？",
          "疑似重复需求复核",
          { confirmButtonText: "确认为独立需求", cancelButtonText: "返回核对" },
        );
        loading.value = false;
        await save(errors.value.duplicates as string[]);
      } catch {}
    } else {
      const first = Object.keys(errors.value)[0] || "";
      navigate(
        first.startsWith("work_locations")
          ? "locations"
          : first.startsWith("materials")
            ? "materials"
            : "basic",
      );
      ElMessage.error(problem.message);
    }
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <ElDialog
    :model-value="open"
    :title="editing ? '修订需求' : '新增专业需求'"
    width="min(1160px,96vw)"
    append-to-body
    class="demand-editor"
    :close-on-click-modal="false"
    :before-close="close"
    @update:model-value="emit('update:open', $event)"
  >
    <ElTabs
      :model-value="section"
      @update:model-value="navigate(String($event))"
      ><ElTabPane label="基本信息" name="basic" /><ElTabPane
        label="作业位置与工作量"
        name="locations" /><ElTabPane
        label="预计物资"
        name="materials" /><ElTabPane label="来源及其他信息" name="sources"
    /></ElTabs>
    <div ref="scroll" class="editor-content">
      <ElForm ref="formRef" :model="draft" label-position="top" novalidate>
        <ElAlert
          v-if="loadError"
          :title="loadError"
          type="error"
          :closable="false"
          ><ElButton v-if="operation" @click="adopt(operation)"
            >重新读取正式单位版本</ElButton
          ></ElAlert
        >
        <section id="demand-section-basic">
          <h2>基本信息</h2>
          <ElFormItem
            label="操作类型"
            prop="operation_id"
            :rules="[{ required: true, message: '请选择操作类型' }]"
            ><FieldControl
              :model-value="draft.operation_id"
              :field="{ type: 'ref', reference: 'operations' }"
              :selected-label="operation?.name"
              @update:model-value="changeOperation"
          /></ElFormItem>
          <ElAlert
            v-if="setupMissing"
            title="尚未配置操作类型，完成作业标准配置后可继续录入当前需求。"
            type="warning"
            :closable="false"
            ><ElButton :disabled="!can('admin')" @click="configure"
              >配置操作类型</ElButton
            ></ElAlert
          >
          <p v-if="operation" class="muted">
            {{ operation.work_object_id_label }} ·
            {{ operation.default_unit_id_label }} · 正式定义第{{
              operation.version
            }}版 · {{ operation.entry_hint }}
            <span v-if="precision !== undefined">{{
              precision === 0
                ? "需求数量（整数）"
                : "需求数量（最多" + precision + "位小数）"
            }}</span>
          </p>
          <ElButton
            v-if="
              editing &&
              operation &&
              latestOperation &&
              latestOperation.version > operation.version
            "
            @click="changeOperation(operation.id, true)"
            >采用当前正式定义（第{{ latestOperation.version }}版）</ElButton
          >
          <ElFormItem
            label="问题描述"
            prop="problem_description"
            :rules="[{ required: true, message: '请填写问题描述' }]"
            ><ElInput
              v-model="draft.problem_description"
              type="textarea"
              :rows="3"
          /></ElFormItem>
          <ElFormItem
            label="验收标准"
            prop="completion_standard"
            :rules="[{ required: true, message: '请填写验收标准' }]"
            ><ElInput
              v-model="draft.completion_standard"
              type="textarea"
              :rows="3"
          /></ElFormItem>
          <ElAlert
            v-if="reviewStandard"
            title="当前验收标准包含手工填写内容，已保留，请核对新操作适用性。"
            type="warning"
            :closable="false"
          />
          <div class="form-grid">
            <ElFormItem label="优先级"
              ><FieldControl
                v-model="draft.priority_id"
                :field="{ type: 'ref', reference: 'priorities' }" /></ElFormItem
            ><ElFormItem label="期望日期"
              ><ElDatePicker
                v-model="draft.expected_on"
                value-format="YYYY-MM-DD"
            /></ElFormItem>
          </div>
          <AttributeFields
            v-model="draft.attributes"
            :definitions="schema"
            scope="demand"
            :errors="errors"
            path="attributes"
          />
        </section>
        <section id="demand-section-locations">
          <div class="toolbar">
            <h2>作业位置与工作量</h2>
            <ElButton
              data-action="add-demand-locations"
              type="primary"
              :disabled="!operation || precision === undefined"
              @click="picker = true"
              >添加作业位置</ElButton
            >
          </div>
          <DemandLocationTable
            :rows="draft.work_locations"
            :definitions="schema"
            :precision="precision"
            :unit="operation?.default_unit_id_label || ''"
            :errors="errors"
            @remove="
              draft.work_locations = draft.work_locations.filter(
                (row) => !$event.includes(row.id),
              )
            "
            @invalid="(id, value) => (invalid[id] = value)"
          />
        </section>
        <section id="demand-section-materials">
          <h2>预计物资</h2>
          <DemandMaterialTable
            :rows="draft.materials"
            @add="draft.materials.push($event)"
            @remove="
              draft.materials = draft.materials.filter(
                (row) => !$event.includes(row.id),
              )
            "
            @invalid="(id, value) => (invalid[id] = value)"
          />
        </section>
        <section id="demand-section-sources">
          <h2>来源依据</h2>
          <div
            v-for="source in draft.sources"
            :key="source.row_id"
            class="source-row"
          >
            <ElFormItem label="来源说明"
              ><ElInput
                v-model="source.description"
                :disabled="source.action === 'delete'" /></ElFormItem
            ><ElFormItem label="发现日期"
              ><ElDatePicker
                v-model="source.discovered_on"
                value-format="YYYY-MM-DD"
                :disabled="source.action === 'delete'" /></ElFormItem
            ><ElButton
              v-if="!source.id"
              type="danger"
              plain
              @click="
                draft.sources = draft.sources.filter(
                  (row) => row.row_id !== source.row_id,
                )
              "
              >移除</ElButton
            ><ElButton
              v-else
              :disabled="!can('admin')"
              type="danger"
              plain
              @click="
                source.action = source.action === 'delete' ? 'upsert' : 'delete'
              "
              >{{
                source.action === "delete" ? "撤销删除" : "删除来源"
              }}</ElButton
            >
          </div>
          <ElButton @click="addSource">补充来源</ElButton>
        </section>
      </ElForm>
    </div>
    <template #footer
      ><span class="muted">草稿自动保留在当前浏览器会话</span
      ><ElButton @click="close()">取消</ElButton
      ><ElButton
        data-action="save-demand"
        type="primary"
        :loading="loading"
        :disabled="!can('write')"
        @click="save()"
        >保存需求版本</ElButton
      ></template
    >
  </ElDialog>
  <DemandLocationPicker
    v-if="operation"
    v-model:open="picker"
    :operation="operation"
    :existing="draft.work_locations"
    @add="addLocations"
  />
</template>
<style scoped>
.editor-content {
  height: min(65vh, 760px);
  overflow: auto;
  padding: 0 14px 10px 2px;
  scroll-padding-top: 12px;
}
.editor-content section {
  margin-bottom: 30px;
}
.source-row {
  display: grid;
  grid-template-columns: 1fr 220px auto;
  gap: 12px;
  align-items: center;
}
.editor-content h2 {
  font-size: 17px;
}
.editor-content .toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
}
@media (max-width: 760px) {
  .source-row {
    grid-template-columns: 1fr;
  }
  .editor-content {
    height: 62vh;
  }
}
</style>
