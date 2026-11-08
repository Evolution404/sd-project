<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import FieldControl from '../components/FieldControl.vue'
import { api, type Row, statusText } from '../services/api'
const props = defineProps<{ kinds: string[], title: string }>()
const definitions = ref<Row>({}), kind = ref(props.kinds[0]!), rows = ref<Row[]>([]), total = ref(0), page = ref(1), query = ref(''), deleted = ref(false), selected = ref<Row[]>([]), dialog = ref(false), loading = ref(false), editing = ref<Row | null>(null), form = ref<Row>({}), errors = ref<Row>({}), formRef = ref(), history = ref<Row | null>(null), tab = ref('basic')
async function load() { loading.value = true; try { const result = await api(`/catalog/${kind.value}?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${deleted.value}`); rows.value = result.items; total.value = result.total } catch (e) { ElMessage.error((e as Error).message) } finally { loading.value = false } }
function edit(row?: Row) { editing.value = row || null; errors.value = {}; form.value = {}; for (const f of fields()) { const value = row?.[f.key] ?? f.default ?? null; form.value[f.key] = f.type === 'json' ? typeof value === 'string' ? value : JSON.stringify(value, null, 2) : value } tab.value = 'basic'; dialog.value = true }
function fields() { const c = definitions.value[kind.value]; return c ? [...c.rootFields, ...c.fields] : [] }
function group(f: Row) { if (kind.value !== 'operations') return 'basic'; if (['fields_json', 'pricing_features_json'].includes(f.key)) return 'extra'; if (['completion_standard','entry_hint','default_target_object','default_quantity_scaled'].includes(f.key)) return 'template'; return 'basic' }
async function save() { if (!await formRef.value?.validate().catch(() => false)) return; loading.value = true; try { const c = definitions.value[kind.value]; await api('/catalog/' + kind.value + (editing.value ? '/' + editing.value.id : ''), 'POST', { ...form.value, expected_version: editing.value?.[c.sequence || 'version_no'] || editing.value?.version || 1 }); dialog.value = false; ElMessage.success('已保存正式版本'); await load() } catch (e) { errors.value = (e as Row).fields || {}; ElMessage.error((e as Error).message) } finally { loading.value = false } }
async function remove(row: Row) { await ElMessageBox.confirm('删除后从正常列表与新增选择中移除，正式历史和已有引用保留。', '确认删除', { type: 'warning' }); const c = definitions.value[kind.value]; try { await api('/catalog/' + kind.value + '/' + row.id, 'DELETE', { expected_version: row[c.sequence || 'version_no'] || row.version || 1 }); await load() } catch (e) { ElMessage.error((e as Error).message) } }
async function viewHistory(row: Row) { history.value = await api(`/catalog/${kind.value}/history/${row.id}`) }
watch(kind, () => { page.value = 1; load() }); watch(() => props.kinds, () => { kind.value = props.kinds[0]! })
onMounted(async () => { definitions.value = await api('/catalogs'); await load() })
</script>
<template>
  <div class="page-heading"><div><div class="section-caption">Master data</div><h1>{{ title }}</h1><p>统一维护业务定义，正式变更保留版本与关联历史。</p></div><ElButton type="primary" @click="edit()">新增{{ definitions[kind]?.title }}</ElButton></div>
  <ElTabs v-model="kind"><ElTabPane v-for="key in kinds" :key="key" :name="key" :label="definitions[key]?.title || key" /></ElTabs>
  <div class="panel"><div class="toolbar"><ElInput v-model="query" clearable placeholder="搜索编码或名称" @change="page = 1; load()" /><ElCheckbox v-model="deleted" @change="load">包含已删除</ElCheckbox><ElButton @click="load">刷新</ElButton><span class="muted">共 {{ total }} 项</span></div>
  <ElTable :data="rows" v-loading="loading" @selection-change="selected = $event"><ElTableColumn type="selection" width="42" /><ElTableColumn label="编码 / 名称" min-width="190"><template #default="{ row }"><strong>{{ row.name || row.title || row.tower_no || row.tower_code || row.line_code }}</strong><div class="muted">{{ row.code || row.logical_code || row.line_code || row.tower_code }}</div></template></ElTableColumn><ElTableColumn label="状态" width="100"><template #default="{ row }"><ElTag :type="row.deleted ? 'danger' : row.status === 'active' ? 'success' : 'info'">{{ row.deleted ? '已删除' : statusText[row.status] || row.status }}</ElTag></template></ElTableColumn><ElTableColumn label="版本" width="75"><template #default="{ row }">{{ row.version_no || row.version || 1 }}</template></ElTableColumn><ElTableColumn label="操作" min-width="210"><template #default="{ row }"><ElButton size="small" :disabled="row.deleted" @click="edit(row)">编辑</ElButton><ElButton size="small" @click="viewHistory(row)">历史</ElButton><ElButton size="small" type="danger" :disabled="row.deleted" @click="remove(row)">删除</ElButton></template></ElTableColumn></ElTable>
  <ElPagination v-model:current-page="page" :page-size="30" :total="total" layout="prev, pager, next, total" @current-change="load" /></div>
  <ElDialog v-model="dialog" :title="(editing ? '编辑' : '新增') + (definitions[kind]?.title || '')" width="800px" :close-on-click-modal="false">
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-model="tab"><ElTabPane label="基本定义" name="basic" /><ElTabPane v-if="kind === 'operations'" label="录入模板" name="template" /><ElTabPane v-if="kind === 'operations'" label="附加字段" name="extra" /><ElTabPane label="影响与预览" name="impact" /></ElTabs>
      <ElAlert v-if="tab === 'impact'" title="提交会生成新定义版本。已签署需求、批准范围、费用与结算继续引用原正式版本。" type="info" :closable="false" />
      <div class="form-grid"><ElFormItem v-for="f in fields()" v-show="group(f) === tab" :key="f.key" :label="f.label" :prop="f.key" :error="errors[f.key]" :rules="f.required ? [{ required: true, message: '请填写' + f.label, trigger: 'blur' }] : []" :class="{ 'full-width': f.type === 'json' }"><FieldControl v-model="form[f.key]" :field="f" :disabled="!!editing && !!f.immutable" /></ElFormItem></div>
    </ElForm><template #footer><ElButton @click="dialog = false">取消</ElButton><ElButton type="primary" :loading="loading" @click="save">保存</ElButton></template>
  </ElDialog>
  <ElDialog :model-value="!!history" title="完整历史" width="900px" @close="history = null"><pre class="data-json">{{ JSON.stringify(history, null, 2) }}</pre></ElDialog>
</template>
