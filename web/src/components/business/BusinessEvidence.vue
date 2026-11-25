<template>
  <section class="mt-3" aria-label="业务附件">
    <div class="mb-3 flex flex-wrap gap-2">
      <el-upload v-if="write" ref="uploader" :show-file-list="false" :disabled="saving" :http-request="upload"
        :on-success="() => uploader?.clearFiles()" :on-error="() => uploader?.clearFiles()">
        <el-button :data-guide-action="evidenceGuide('add')" type="primary" :loading="saving">上传附件</el-button>
      </el-upload>
      <el-checkbox :data-guide-action="evidenceGuide('filter')" v-model="includeDeleted">包括已移除</el-checkbox>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" class="mb-2" />
    <el-table v-loading="loading" :data="rows" row-key="id" border>
      <el-table-column label="文件" min-width="165">
        <template #default="{ row }">
          <el-link v-if="!row.deleted" type="primary" :data-guide-action="evidenceGuide('download')" :href="evidenceUrl(row.id)">{{ row.filename }}</el-link>
          <span v-else>{{ row.filename }}（已移除）</span>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="说明" min-width="140" />
      <el-table-column label="关联时间" min-width="170">
        <template #default="{ row }">{{ formatBeijingDateTime(row.linked_at) }}</template>
      </el-table-column>
      <el-table-column v-if="write || admin" label="操作" min-width="155">
        <template #default="{ row }">
          <el-button v-if="write && !row.deleted" link type="primary" :disabled="saving" :data-guide-action="evidenceGuide('revise')" @click="revise(row.id, row.note)">修订说明</el-button>
          <el-button v-if="admin && !row.deleted" link type="danger" :disabled="saving" :data-guide-action="evidenceGuide('delete')" @click="remove(row.id)">移除关联</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UploadInstance, UploadRequestOptions } from "element-plus";
import { useUserStore } from "@/stores";
import { evidenceGuide as evidenceGuideId } from "@/guides/registry/native-bindings";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import {
  evidenceUrl, listEvidence, removeEvidence, updateEvidenceNote, uploadEvidence,
  type EvidenceOwner, type EvidenceRecord,
} from "@/api/business/evidence";

const props = defineProps<{ owner: string; kind: EvidenceOwner; readonly?: boolean }>();
const user = useUserStore();
const evidenceGuide=(action:"add"|"filter"|"download"|"revise"|"delete")=>evidenceGuideId(props.kind,action);
const write = computed(() => !props.readonly && user.userInfo.perms.includes("write"));
const admin = computed(() => !props.readonly && user.userInfo.perms.includes("admin"));
const rows = ref<EvidenceRecord[]>([]);
const uploader = ref<UploadInstance>();
const includeDeleted = ref(false), saving = ref(false), loading = ref(false), error = ref("");
let sequence = 0;
async function load() {
  const request = ++sequence;
  loading.value = true;
  error.value = "";
  try {
    const result = await listEvidence(props.kind, props.owner, includeDeleted.value);
    if (request === sequence) rows.value = result;
  } catch (cause) {
    if (request === sequence) error.value = (cause as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}
async function save(operation: () => Promise<unknown>) {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await operation();
    await load();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}
function upload({ file }: UploadRequestOptions) {
  const { owner, kind } = props;
  return save(() => uploadEvidence(kind, owner, file));
}
async function revise(id: string, note: string) {
  try {
    const { value } = await ElMessageBox.prompt("填写附件说明", "修订附件说明", {
      inputValue: note, inputValidator: value => value.length <= 2000 || "附件说明不能超过 2000 字",
    });
    await save(() => updateEvidenceNote(id, value));
  } catch {
    return;
  }
}
async function remove(id: string) {
  try {
    await ElMessageBox.confirm("移除当前关联，原附件仍保留在历史记录。", "移除附件关联", { type: "warning" });
    await save(() => removeEvidence(id));
  } catch {
    return;
  }
}
watch(() => [props.owner, props.kind, includeDeleted.value], () => { rows.value = []; void load(); }, { immediate: true });
</script>
