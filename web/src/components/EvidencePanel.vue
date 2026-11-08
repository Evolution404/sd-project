<script setup lang="ts">
import { ref,onMounted } from 'vue'
import { ElMessage,ElMessageBox } from 'element-plus'
import { api,download,type Row } from '../services/api'
const props=defineProps<{ownerKind:string,ownerId:string}>()
const rows=ref<Row[]>([]),busy=ref(false)
async function load(){rows.value=await api(`/evidence?owner_kind=${props.ownerKind}&owner_id=${props.ownerId}`)}
async function upload(file:Row){busy.value=true;try{const data=new Uint8Array(await file.raw.arrayBuffer());if(data.length>10*1024*1024)throw Error('附件不能超过10MB');let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));await api('/evidence','POST',{owner_kind:props.ownerKind,owner_id:props.ownerId,filename:file.name,mime:file.raw.type,base64:btoa(binary)});await load()}catch(e){ElMessage.error((e as Error).message)}finally{busy.value=false}}
async function remove(row:Row){await ElMessageBox.confirm('从正常附件列表移除，原证据和关联历史保留。','删除附件');await api('/evidence/'+row.id,'DELETE',{});await load()}
onMounted(load)
</script>
<template><div class="panel"><div class="toolbar"><h2>证据附件</h2><ElUpload :auto-upload="false" :show-file-list="false" :on-change="upload"><ElButton :loading="busy">添加附件</ElButton></ElUpload></div><ElTable :data="rows"><ElTableColumn prop="filename" label="文件" /><ElTableColumn prop="bytes" label="字节数" width="120" /><ElTableColumn label="操作" width="190"><template #default="{row}"><ElButton @click="download('/evidence/'+row.id,row.filename)">下载</ElButton><ElButton type="danger" @click="remove(row)">删除</ElButton></template></ElTableColumn></ElTable></div></template>
