<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, download, type Row } from '../services/api'
const props = defineProps<{ kind: 'demands' | 'settlements', selectedIds?: string[], query?: string }>()
const emit = defineEmits(['changed'])
const dialog = ref(false), mode = ref('mixed'), atomic = ref(false), preview = ref<Row | null>(null), busy = ref(false), result = ref<Row | null>(null), requestKey = ref('')
async function exportFile(report = false, selected = false) { const query = new URLSearchParams({ q: props.query || '', report: String(report) }); if (selected) for (const id of props.selectedIds || []) query.append('id', id); await download(`/exchange/${props.kind}/export?${query}`, `${props.kind}-${report ? '报表' : '数据维护'}.xlsx`) }
async function upload(file: Row) { busy.value = true; preview.value = null; result.value = null; try { const response = await fetch(`/api/exchange/${props.kind}/preview?mode=${mode.value}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file.raw }); const value = await response.json(); if (!response.ok) throw new Error(value.message); preview.value = value; requestKey.value = crypto.randomUUID() } catch (e) { ElMessage.error((e as Error).message) } finally { busy.value = false } }
async function commit() { busy.value = true; try { result.value = await api(`/exchange/${preview.value!.token}/commit`, 'POST', { request_key: requestKey.value, atomic: atomic.value }); ElMessage.success('导入结果已保存'); emit('changed') } catch (e) { ElMessage.error((e as Error).message) } finally { busy.value = false } }
</script>
<template>
  <ElButton @click="dialog = true">Excel 批量处理</ElButton>
  <ElDialog v-model="dialog" title="Excel 数据交换" width="1060px" :close-on-click-modal="false">
    <div class="toolbar"><ElButton @click="download(`/exchange/${kind}/template`, `${kind}-模板.xlsx`)">空白模板</ElButton><ElButton @click="exportFile()">筛选结果维护导出</ElButton><ElButton :disabled="!selectedIds?.length" @click="exportFile(false, true)">勾选项维护导出</ElButton><ElButton @click="exportFile(true)">业务报表</ElButton></div>
    <ElAlert :title="kind === 'settlements' ? '导入仅保存结算草稿，提交与审核需分别确认。金额与本次新增解决量独立填写。' : '需求更新生成新的正式内容版本。缺少位置或物资行保持原值，删除须明确标记。'" type="info" :closable="false" />
    <div class="toolbar" style="margin-top:18px"><ElSelect v-model="mode" style="width:180px"><ElOption label="仅新增" value="create" /><ElOption label="仅更新" value="update" /><ElOption label="混合新增与更新" value="mixed" /></ElSelect><ElUpload accept=".xlsx" :auto-upload="false" :show-file-list="false" :on-change="upload"><ElButton type="primary" :loading="busy">上传并预检</ElButton></ElUpload><ElCheckbox v-model="atomic">整个批次全部成功或全部回滚</ElCheckbox></div>
    <template v-if="preview"><div class="toolbar"><ElTag>新增 {{ preview.summary.created }}</ElTag><ElTag>更新 {{ preview.summary.updated }}</ElTag><ElTag type="info">无变化 {{ preview.summary.unchanged }}</ElTag><ElTag type="danger">问题 {{ preview.issues.length }}</ElTag><ElButton @click="download(`/exchange/${preview.token}/errors`, '导入问题.xlsx')">下载问题清单</ElButton></div>
    <ElTabs><ElTabPane label="单据与逐字段变化"><ElTable :data="preview.documents" max-height="380"><ElTableColumn prop="number" label="业务编号" width="140" /><ElTableColumn prop="action" label="动作" width="100" /><ElTableColumn label="变化"><template #default="{ row }"><div v-for="change in row.changes" :key="change.field"><strong>{{ change.field }}</strong> {{ JSON.stringify(change.before) }} → {{ JSON.stringify(change.after) }}</div></template></ElTableColumn></ElTable></ElTabPane><ElTabPane label="问题清单"><ElTable :data="preview.issues" max-height="380"><ElTableColumn prop="sheet" label="工作表" /><ElTableColumn prop="row" label="行号" width="70" /><ElTableColumn prop="field" label="字段" /><ElTableColumn prop="reason" label="问题" min-width="220" /><ElTableColumn prop="suggestion" label="建议" /></ElTable></ElTabPane></ElTabs></template>
    <ElAlert v-if="result" class="error-banner" :title="`已处理 ${result.results.length} 张单据，失败 ${result.issues.length} 项`" :type="result.issues.length ? 'warning' : 'success'" :closable="false" />
    <template #footer><ElButton @click="dialog = false">关闭</ElButton><ElButton type="primary" :disabled="!preview || !!result || (atomic && preview.issues.length > 0)" :loading="busy" @click="commit">确认提交有效单据</ElButton></template>
  </ElDialog>
</template>
