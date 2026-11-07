<script setup lang="ts">
import {computed,ref} from 'vue';
import {ElAlert,ElButton,ElCard,ElFormItem,ElInput,ElMessageBox,ElOption,ElSelect,ElTabPane,ElTabs,ElTag} from 'element-plus';
import OperationFieldsEditor from './OperationFieldsEditor.vue';
type Row=Record<string,any>;
const props=defineProps<{modelValue:Row;units:Row[];original?:Row|null}>();
const emit=defineEmits<{(event:'update:modelValue',value:Row):void}>();
const tab=ref('definition');
const profile=computed(()=>props.modelValue.operation_profile||{});
const kinds=computed<string[]>(()=>profile.value.location_kinds||[]);
const unitName=computed(()=>props.units.find(u=>u.id===props.modelValue.default_unit_id)?.name||'尚未配置');
const targetName=computed(()=>props.modelValue.work_target_type==='physical'?'共用物理杆塔':'线路侧设备');
const positionName=(kind:string)=>kind==='span'?'档距':'杆塔';
function update(patch:Row){emit('update:modelValue',{...props.modelValue,...patch})}
function updateProfile(patch:Row){update({operation_profile:{...profile.value,...patch}})}
function setKinds(value:string[]){updateProfile({location_kinds:value,default_location_kind:value.includes(profile.value.default_location_kind)?profile.value.default_location_kind:value[0]||''})}
async function setTarget(value:string){
 if(value==='physical'&&kinds.value.includes('span')){
  try{await ElMessageBox.confirm('共用物理杆塔作业只能使用杆塔定位。确认后将移除本操作的档距选项，已保存业务的位置和快照保持原样。','调整操作定位范围',{confirmButtonText:'采用杆塔定位',cancelButtonText:'保留原定义'})}catch{return}
  update({work_target_type:value,operation_profile:{...profile.value,location_kinds:['tower'],default_location_kind:'tower'}});
 }else update({work_target_type:value});
}
const positionRules=[{validator:(_r:unknown,value:unknown,done:(e?:Error)=>void)=>{
 const a=Array.isArray(value)?value:[];
 done(!a.length?new Error('请至少选择一种作业位置'):props.modelValue.work_target_type==='physical'&&a.some(k=>k!=='tower')?new Error('共用物理杆塔仅支持杆塔定位'):undefined);
},trigger:'change'}];
const defaultPositionRules=[{validator:(_r:unknown,value:unknown,done:(e?:Error)=>void)=>done(kinds.value.includes(String(value))?undefined:new Error('请选择允许范围内的默认作业位置')),trigger:'change'}];
const quantityRules=[{validator:(_r:unknown,value:unknown,done:(e?:Error)=>void)=>{const raw=String(value??'');done(raw!==''&&(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(raw)||Number(raw)<=0)?new Error('建议数量为正数，最多四位小数'):undefined)},trigger:'blur'}];
function revealError(keys:string[]){tab.value=keys.some(k=>k.startsWith('fields.'))?'fields':keys.some(k=>['default_quantity','completion_standard','operation_profile.default_target_object','operation_profile.entry_hint'].includes(k))?'template':'definition'}
defineExpose({revealError});
</script>
<template>
 <div class="operation-definition-editor">
  <ElAlert title="先定义做什么、在哪类位置做、作用于什么对象以及如何计量；需求录入将按本定义联动。" type="info" :closable="false"/>
  <ElTabs v-model="tab" class="operation-definition-tabs">
   <ElTabPane label="基本定义" name="definition">
    <div class="operation-definition-grid">
     <ElFormItem label="操作名称" prop="name" :rules="[{required:true,whitespace:true,message:'请填写操作名称',trigger:'blur'}]"><ElInput :model-value="modelValue.name" aria-label="名称" maxlength="80" placeholder="例如：安装防鸟装置" @update:model-value="v=>update({name:v})"/></ElFormItem>
     <ElFormItem label="状态" prop="status"><ElSelect :model-value="modelValue.status" aria-label="状态" @update:model-value="v=>update({status:v})"><ElOption label="启用" value="active"/><ElOption label="停用" value="inactive"/></ElSelect></ElFormItem>
     <ElFormItem label="计量单位" prop="default_unit_id" :rules="[{required:true,message:'请选择操作类型的计量单位',trigger:'change'}]"><ElSelect :model-value="modelValue.default_unit_id" aria-label="计量单位" filterable placeholder="本操作的固定计量单位" @update:model-value="v=>update({default_unit_id:v})"><ElOption v-for="unit in units" :key="unit.id" :value="unit.id" :label="unit.name+(unit.status!=='active'?'（不可用于新录入）':'')" :disabled="unit.status!=='active'"/></ElSelect></ElFormItem>
     <ElFormItem label="作业对象" prop="work_target_type" :rules="[{required:true,message:'请选择作业对象',trigger:'change'}]"><ElSelect :model-value="modelValue.work_target_type" aria-label="作业对象" @update:model-value="setTarget"><ElOption label="线路侧设备" value="line"/><ElOption label="共用物理杆塔" value="physical"/></ElSelect></ElFormItem>
     <ElFormItem label="允许的作业位置" prop="operation_profile.location_kinds" required :rules="positionRules"><ElSelect :model-value="kinds" aria-label="允许的作业位置" multiple @update:model-value="setKinds"><ElOption label="杆塔" value="tower"/><ElOption label="档距" value="span" :disabled="modelValue.work_target_type==='physical'"/></ElSelect><small>只有一种时自动确定；允许两种时，录入仅能在此范围选择。</small></ElFormItem>
     <ElFormItem label="默认作业位置" prop="operation_profile.default_location_kind" required :rules="defaultPositionRules"><ElSelect :model-value="profile.default_location_kind" aria-label="默认作业位置" :disabled="kinds.length<=1" @update:model-value="v=>updateProfile({default_location_kind:v})"><ElOption v-for="kind in kinds" :key="kind" :label="positionName(kind)" :value="kind"/></ElSelect></ElFormItem>
    </div>
    <ElAlert v-if="original&&!original.operation_profile" title="该操作尚未配置作业位置，请人工核对后保存。系统不会猜测既有业务的位置。" type="warning" :closable="false"/>
   </ElTabPane>
   <ElTabPane label="录入模板" name="template">
    <p class="muted">以下内容用于预填和提示。实际位置、工作量和问题依据仍须逐条核对，切换单位不自动换算数量。</p>
    <div class="operation-definition-grid">
     <ElFormItem label="默认处理部位" prop="operation_profile.default_target_object"><ElInput :model-value="profile.default_target_object||''" aria-label="默认处理部位" maxlength="1000" placeholder="例如：横担上部；留空则逐条填写" @update:model-value="v=>updateProfile({default_target_object:v})"/></ElFormItem>
     <ElFormItem label="建议每项数量" prop="default_quantity" :rules="quantityRules"><ElInput :model-value="modelValue.default_quantity" aria-label="默认每项数量" inputmode="decimal" placeholder="留空则人工填写，不是整批总量" @update:model-value="v=>update({default_quantity:v})"/><small>计量单位：{{unitName}}。仅作为建议，不限制真实工作量。</small></ElFormItem>
     <ElFormItem class="operation-wide" label="完成标准模板" prop="completion_standard"><ElInput :model-value="modelValue.completion_standard" aria-label="默认完成标准" type="textarea" :rows="3" placeholder="例如：按核定部位完成安装并验收合格" @update:model-value="v=>update({completion_standard:v})"/></ElFormItem>
     <ElFormItem class="operation-wide" label="录入提示" prop="operation_profile.entry_hint"><ElInput :model-value="profile.entry_hint||''" aria-label="录入提示" type="textarea" :rows="3" maxlength="2000" placeholder="说明部位如何填写、数量如何计量、需要核对什么" @update:model-value="v=>updateProfile({entry_hint:v})"/></ElFormItem>
    </div>
   </ElTabPane>
   <ElTabPane label="附加字段" name="fields"><p class="muted">维护本操作专用的相位、串位、型号等字段，配置类型、必填、可选项和默认值。</p><OperationFieldsEditor :model-value="modelValue.fields||[]" @update:model-value="v=>update({fields:v})"/></ElTabPane>
   <ElTabPane label="影响与预览" name="preview">
    <div class="operation-preview">
     <ElCard shadow="never"><template #header><strong>录入时自动联动</strong></template><p><strong>{{modelValue.name||'尚未填写操作名称'}}</strong></p><p>作业对象：{{targetName}}</p><p>作业位置：{{kinds.map(positionName).join('／')||'尚未配置'}}；默认{{profile.default_location_kind?positionName(profile.default_location_kind):'尚未配置'}}</p><p>计量单位：{{unitName}}</p><p>建议数量：{{modelValue.default_quantity||'人工填写'}}</p><p>默认部位：{{profile.default_target_object||'人工填写'}}</p><p>完成标准：{{modelValue.completion_standard||'人工填写'}}</p><p v-if="profile.entry_hint">提示：{{profile.entry_hint}}</p><ElTag v-for="field in modelValue.fields||[]" :key="field.key" class="operation-field-tag">{{field.label||'未命名字段'}}{{field.required?' · 必填':''}}</ElTag></ElCard>
     <ElCard shadow="never"><template #header><strong>变更影响</strong></template><p>当前配置版本：{{original?'v'+original.version:'新定义'}}</p><p>业务引用：{{original?.usage_count||0}} 条；配置引用：{{original?.configuration_usage_count||0}} 项。</p><p>保存产生新配置版本，新录入按新定义执行，未提交草稿需重新校验。</p><p>已保存需求、项目和计划采用的位置、单位、对象、数量及预算／结算事实保持原样。</p><p class="muted">本区仅预览录入效果，不生成需求或业务台账。</p></ElCard>
    </div>
   </ElTabPane>
  </ElTabs>
 </div>
</template>
<style scoped>
.operation-definition-grid,.operation-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.operation-definition-editor{min-width:0}.operation-definition-tabs{margin-top:14px}.operation-definition-grid>*{min-width:0}.operation-definition-grid .el-select{width:100%}.operation-wide{grid-column:1/-1}.operation-definition-editor small{display:block;color:var(--el-text-color-secondary);font-size:12px;line-height:1.6}.operation-preview{gap:16px}.operation-preview p{overflow-wrap:anywhere;line-height:1.7}.operation-field-tag{margin:4px}.operation-definition-editor :deep(.el-tabs__item){padding:0 17px}
@media(max-width:800px){.operation-definition-grid,.operation-preview{grid-template-columns:minmax(0,1fr)}.operation-definition-editor :deep(.el-tabs__item){padding:0 9px;font-size:13px}}
</style>
