<template>
  <el-card shadow="never">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
      <div><h3 class="text-lg font-semibold">设备资料批量编辑</h3>
        <el-text type="info">本次编辑 {{records.length}} 条设备；设备身份、关联关系和状态只读。数量按米填写，字典填写正式名称。</el-text>
      </div>
      <el-space wrap>
        <el-button :disabled="saving" @click="cancel">返回查看态</el-button>
        <el-button data-guide-action="ledger.bulk-save" type="primary" :loading="saving" :disabled="!ready||saving" @click="save">保存 {{modifiedCount}} 条修改</el-button>
      </el-space>
    </div>
    <BusinessWorksheet ref="sheet" name="设备资料" session-key="equipment-bulk" :rows="rows" :columns="columns"
      :validate="validate" :disabled="saving" @change="draft=$event" @readiness-change="ready=$event"/>
    <el-alert class="mt-4" type="info" :closable="false" title="批次原子提交，任何身份、版本、字段或业务验证失败均整批回滚。"/>
  </el-card>
</template>
<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,shallowRef} from "vue";
import {onBeforeRouteLeave,onBeforeRouteUpdate} from "vue-router";
import {ElMessage,ElMessageBox} from "element-plus";
import {listRouteIdentity} from "@/components/Crud/utils/list-state";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type {WorksheetColumn,WorksheetRow,WorksheetValues,WorksheetIssue} from "@/components/BusinessWorksheet/univer-engine";
import {bulkUpdateEquipment,type EquipmentRow} from "@/api/business/equipment";
import type {OptionItem} from "@/api/common";
import {EQUIPMENT_BULK_FIELDS,EQUIPMENT_FIELD_META,equipmentStatus,equipmentLineKind,type EquipmentBulkKind} from "../../../../server/shared/equipment-bulk";
import {exactScaledDecimalText,formatScaledDecimal} from "@/utils/business/fixed-scale";
const props=defineProps<{kind:EquipmentBulkKind;records:EquipmentRow[];options:Record<string,OptionItem[]>}>();
const emit=defineEmits<{cancel:[];saved:[]}>();
const sheet=ref<InstanceType<typeof BusinessWorksheet>>();
const ready=ref(false),saving=ref(false);
const fields=EQUIPMENT_BULK_FIELDS[props.kind] as readonly (keyof EquipmentRow)[];
const numeric=Object.keys(EQUIPMENT_FIELD_META).filter(key=>EQUIPMENT_FIELD_META[key].type==="number");
const identityColumns:WorksheetColumn[]=props.kind==="lines"?[
  {key:"line_code",title:"线路编号",width:145}
]:props.kind==="physical"?[
  {key:"tower_code",title:"物理杆塔编号",width:145}
]:props.kind==="towers"?[
  {key:"line_id_label",title:"所属线路",width:180},
  {key:"logical_code",title:"逻辑杆塔编号",width:145}
]:[
  {key:"line_id_label",title:"所属线路",width:180},{key:"start_tower_no",title:"起点杆塔号",width:110},
  {key:"end_tower_no",title:"终点杆塔号",width:110}
];
const columns:WorksheetColumn[]=[...identityColumns,
  ...fields.map(key=>({key,title:EQUIPMENT_FIELD_META[key].title,width:170,editable:true,numeric:numeric.includes(key),
    options:EQUIPMENT_FIELD_META[key].type==="select"?(props.options[key]??[]).map(item=>String(item.label)):undefined,
    required:EQUIPMENT_FIELD_META[key].required})),
  ...(props.kind==="lines"?[{key:"line_kind",title:"线路性质",width:110}]:[]),
  {key:"version",title:"正式版本",width:110},{key:"status",title:"状态",width:110}];
const original=props.records.map(row=>({...row}));
function display(row:EquipmentRow,key:keyof EquipmentRow):string{
  if(key==="height_scaled")return row.height_scaled==null?"":formatScaledDecimal(row.height_scaled,4);
  if(key==="transmission_center_length_mm")return row.transmission_center_length_mm==null?"":formatScaledDecimal(row.transmission_center_length_mm,3);
  if(key==="voltage_level_id")return row.voltage_level_name??"";
  if(key==="line_kind")return equipmentLineKind(row.line_kind);
  if(key==="status")return equipmentStatus(row.status);
  if(key==="tower_material"||key==="tower_nature")return String(row[key+"_label" as keyof EquipmentRow]??row[key]??"");
  return String(row[key]??"");
}
const rows:WorksheetRow[]=original.map(row=>({id:row.id,label:row.line_code||row.tower_code||row.logical_code||row.start_tower_no||row.id,values:{version:String(row.version),status:equipmentStatus(row.status),line_kind:equipmentLineKind(row.line_kind),...Object.fromEntries(identityColumns.map(column=>[column.key,display(row,column.key as keyof EquipmentRow)])),...Object.fromEntries(fields.map(key=>[key,display(row,key)]))}}));
const draft=shallowRef<WorksheetValues>(Object.fromEntries(rows.map(row=>[row.id,row.values])));
function convert(key:keyof EquipmentRow,raw:string){
  const value=raw.trim();
  if(key==="name"||key==="tower_no"){if(!value)throw Error(EQUIPMENT_FIELD_META[key].title+"不能为空");return value}
  if(key==="asset_no")return value||null;
  if(key==="sort_rank"){const n=Number(value);if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(n))throw Error("线路排序必须为正整数");return n;}
  if(key==="tower_material"||key==="tower_nature"||key==="voltage_level_id"){
    if(!value){if(key==="voltage_level_id")throw Error("请选择电压等级");return null;}
    const matches=(props.options[key]??[]).filter(item=>item.label===value||String(item.value)===value);
    if(matches.length!==1)throw Error("请填写唯一的有效正式字典名称");
    return String(matches[0].value);
  }
  if(key==="height_scaled"||key==="transmission_center_length_mm"){
    if(!value)return null;
    const precision=key==="height_scaled"?4:3, n=exactScaledDecimalText(value,precision);
    if(n===null||n<0)throw Error("须填写非负数值且最多 "+precision+" 位小数");
    return n;
  }
  if(key==="longitude"||key==="latitude"){
    if(!value)return null;
    const n=Number(value),limit=key==="longitude"?180:90;
    if(!/^[+-]?\d+(\.\d{1,6})?$/.test(value)||!Number.isFinite(n)||Math.abs(n)>limit)throw Error("坐标范围无效，最多六位小数");
    return n;
  }
  if(key==="commissioned_on"){
    if(!value)return null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error("请填写有效日期 YYYY-MM-DD");
    return value;
  }
  if(key==="display_name")return value||null;
  return raw;
}
function validate(values:WorksheetValues):WorksheetIssue[]{
  const issues:WorksheetIssue[]=[];
  original.forEach((row,i)=>fields.forEach((key,j)=>{
    const raw=values[row.id]?.[key]??"";
    if(raw===display(row,key))return;
    try{convert(key,raw)}catch(cause){
      const message=cause instanceof Error?cause.message:String(cause);
      issues.push({row:i+1,column:j+identityColumns.length,cell:String.fromCharCode(65+j+identityColumns.length)+(i+2),rowId:row.id,field:key,location:row.label,message});
    }
  }));
  return issues;
}
const modifiedCount=computed(()=>original.filter(row=>fields.some(key=>(draft.value[row.id]?.[key]??"")!==display(row,key))).length);
function collect(values:WorksheetValues){
  return original.flatMap(row=>{
    const changes=Object.fromEntries(fields.filter(key=>(values[row.id]?.[key]??"")!==display(row,key)).map(key=>[key,convert(key,values[row.id]?.[key]??"")]));
    return Object.keys(changes).length?[{id:row.id,expected_version:row.version,changes}]:[];
  });
}
async function mayLeave(){
  if(saving.value)return false;
  await sheet.value?.finishEditing();
  if(!modifiedCount.value)return true;
  try{await ElMessageBox.confirm("还有未保存修改，确定退出批量编辑吗？","放弃修改",{type:"warning",confirmButtonText:"退出",cancelButtonText:"继续编辑"});return true}catch{return false}
}
async function cancel(){if(await mayLeave())emit("cancel")}
function beforeUnload(event:BeforeUnloadEvent){if(modifiedCount.value||sheet.value?.changed()){event.preventDefault();event.returnValue=""}}
async function leaveRoute(){if(!await mayLeave())return false;emit("cancel");return true}
onBeforeRouteLeave(leaveRoute);
onBeforeRouteUpdate((to,from)=>listRouteIdentity(to.fullPath)===listRouteIdentity(from.fullPath)?true:leaveRoute());
onMounted(()=>window.addEventListener("beforeunload",beforeUnload));
onUnmounted(()=>window.removeEventListener("beforeunload",beforeUnload));
async function save(){
  if(!ready.value||saving.value)return;
  saving.value=true;
  try{
    const values=await sheet.value?.prepareSave();if(!values)return;
    const pending=collect(values);if(!pending.length){ElMessage.info("没有需要保存的修改");return}
    await ElMessageBox.confirm("将为 "+pending.length+" 条设备生成新正式版本，任一验证失败整批回滚。确认保存？","提交设备批量修改",{type:"warning",confirmButtonText:"确认保存",cancelButtonText:"继续编辑"});
    const result=await bulkUpdateEquipment(props.kind,pending);
    ElMessage.success("已更新 "+result.count+" 条设备的正式版本");emit("saved");
  }catch(e){if(e!=="cancel"&&e!=="close")ElMessage.error(e instanceof Error?e.message:String(e))}
  finally{saving.value=false}
}
</script>
