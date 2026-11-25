<template>
  <el-dialog :model-value="true" title="按杆号快速选择" append-to-body align-center width="900px"
    :close-on-click-modal="false" @close="emit('close')">
    <el-form label-position="top" novalidate :disabled="busy">
      <el-form-item label="所属线路" required>
        <el-select v-model="lineId" filterable remote :remote-method="searchLines" :loading="searching"
          placeholder="搜索所属线路" @change="reset">
          <el-option v-for="line in lines" :key="line.id" :value="line.id" :label="line.name"/>
        </el-select>
      </el-form-item>
      <el-form-item :label="kind==='span'?'档距端点清单':'杆号清单或连续区间'" required>
        <el-input v-model="input" type="textarea" :rows="4"
          :placeholder="kind==='span'?'12~13、13~14':'12、13、18-25、1786+1、1786-1'" @input="reset"/>
      </el-form-item>
      <div class="business-control-row mb-3">
        <el-button type="primary" :disabled="!lineId||!input.trim()" :loading="busy" @click="match">匹配并选择</el-button>
        <el-text>成功匹配 {{ selected.length }} 处；现有 {{ existingCount }} 处，最多5000处</el-text>
      </div>
      <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3"/>
      <el-table v-if="results.length" :data="results" border max-height="320">
        <el-table-column prop="number" label="原始杆号 / 档距端点" min-width="180"/>
        <el-table-column prop="result" label="匹配结果" min-width="220"/>
      </el-table>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="busy||!selected.length" @click="emit('confirm',selected.slice(),lineId)">
        添加所选位置（{{ selected.length }}）
      </el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref,shallowRef} from "vue";
import {listEquipment,type EquipmentRow,type EquipmentKind} from "@/api/business/equipment";
import {parseTowerList} from "@/utils/business/tower-number-list";
import type {DemandLocationInput} from "../../../../server/shared/types/demands";
const props=defineProps<{kind:DemandLocationInput["location_kind"];existingCount:number;selectable:(row:EquipmentRow)=>boolean}>();
const emit=defineEmits<{close:[];confirm:[rows:EquipmentRow[],lineId:string]}>();
const lineId=ref(""),input=ref(""),lines=shallowRef<EquipmentRow[]>([]),searching=ref(false),busy=ref(false),error=ref("");
const results=ref<{number:string;result:string}[]>([]),selected=shallowRef<EquipmentRow[]>([]);
let searchSequence=0,matchSequence=0;
async function searchLines(keyword:string){
  const current=++searchSequence;searching.value=true;
  try{
    const page=await listEquipment("lines",{keyword,size:200,filters:{status:"active"}});
    if(current===searchSequence)lines.value=page.items;
  }catch(cause){if(current===searchSequence)error.value=(cause as Error).message}
  finally{if(current===searchSequence)searching.value=false}
}
function reset(){matchSequence++;busy.value=false;results.value=[];selected.value=[];error.value=""}
async function match(){
  reset();
  const current=matchSequence,line=lineId.value,raw=input.value,kind=props.kind;
  if(!line||!raw.trim())return;
  busy.value=true;
  try{
    const rawTokens=raw.split(/[\s,，、;；]+/).filter(Boolean);
    if(rawTokens.length>5000)throw Error("单次清单最多5000项");
    const catalog:EquipmentKind=kind==="physical_tower"?"physical":kind==="logical_tower"?"towers":"spans";
    const candidates:EquipmentRow[]=[];
    for(let page=1;;page++){
      const data=await listEquipment(catalog,{page,size:200,lineId:line,filters:{status:"active"}});
      if(current!==matchSequence)return;
      if(data.total>5000)throw Error("线路匹配范围超过5000处，请核实台账");
      candidates.push(...data.items);
      if(candidates.length>=data.total)break;
      if(!data.items.length)throw Error("台账分页结果不完整，请重新匹配");
    }
    const index=new Map<string,Map<string,EquipmentRow>>();
    for(const row of candidates){
      if(row.deleted||row.status!=="active")continue;
      const keys=kind==="physical_tower"?(row.bindings??[]).filter(b=>b.line_id===line&&!b.logical_deleted&&b.logical_status==="active").map(b=>b.tower_no):
        kind==="span"?[row.start_tower_no+"~"+row.end_tower_no]:[row.tower_no??""];
      for(const key of keys){
        if(!key)continue;
        const records=index.get(key)??new Map<string,EquipmentRow>();records.set(row.id,row);index.set(key,records);
      }
    }
    const tokens=kind==="span"?rawTokens:parseTowerList(raw,index.keys());
    const seen=new Set<string>(),chosen=new Map<string,EquipmentRow>(),report:{number:string;result:string}[]=[];
    for(const number of tokens){
      const matches=[...(index.get(number)?.values()??[])];
      let result="匹配成功";
      if(seen.has(number))result="清单重复";
      else if(!matches.length)result="台账不存在或位置类型不适用";
      else if(matches.length!==1)result="名称歧义，须核实";
      else if(chosen.has(matches[0].id)||!props.selectable(matches[0]))result="已选择或重复";
      else chosen.set(matches[0].id,matches[0]);
      seen.add(number);report.push({number,result});
    }
    if(props.existingCount+chosen.size>5000)throw Error("添加后将超过5000处，未改变现有选择");
    if(current===matchSequence){results.value=report;selected.value=[...chosen.values()]}
  }catch(cause){if(current===matchSequence)error.value=(cause as Error).message}
  finally{if(current===matchSequence)busy.value=false}
}
onMounted(()=>void searchLines(""));
onBeforeUnmount(()=>{searchSequence++;matchSequence++});
</script>
