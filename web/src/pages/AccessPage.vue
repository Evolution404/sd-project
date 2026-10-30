<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue';
import {ElButton,ElDialog,ElForm,ElFormItem,ElInput,ElTable,ElTableColumn,type FormInstance} from 'element-plus';
import {requestApi} from '../api/client';
type Entry={id:string;ip:string;note:string;created_at:string;created_by_name:string};
const entries=ref<Entry[]>([]),currentIP=ref(''),addOpen=ref(false),pendingRemove=ref<Entry|null>(null);
const busy=ref(false),loading=ref(false),error=ref(''),notice=ref('');
const form=reactive({ip:'',note:''});
const formRef=ref<FormInstance>();
async function refresh(){
 loading.value=true;error.value='';
 try{
  const result=await requestApi<{entries:Entry[],current_ip:string}>('/access/ips');
  entries.value=result.entries;currentIP.value=result.current_ip;
 }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
async function add(){
 if(busy.value)return;
 const valid=await formRef.value?.validate().catch(()=>false);
 if(!valid)return;
 busy.value=true;error.value='';
 try{
  await requestApi('/access/ips','POST',{ip:form.ip.trim(),note:form.note.trim()});
  addOpen.value=false;form.ip='';form.note='';await refresh();notice.value='访问IP已授权，立即生效';
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function remove(){
 if(!pendingRemove.value||busy.value)return;
 busy.value=true;error.value='';
 try{
  const ip=pendingRemove.value;
  await requestApi('/access/ips/'+encodeURIComponent(ip.id),'DELETE');
  pendingRemove.value=null;await refresh();notice.value='已撤销 '+ip.ip+' 的访问权限';
 }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
onMounted(refresh);
</script>
<template>
<section class="panel">
 <div class="section-header"><div><h2>允许访问的 IP</h2><p class="muted">逐个配置具体IP地址；保存后无需重启服务</p></div></div>
 <p class="muted">服务器识别到本次连接的地址：<strong class="mono">{{currentIP}}</strong>。本机 127.0.0.1 和 ::1 永久允许，用于初始化和应急管理。其他地址未加入列表时默认拒绝。</p>
 <ElButton class="primary" @click="addOpen=true;notice='';error=''">＋ 添加允许 IP</ElButton>
 <p v-if="error" role="alert" class="alert error">{{error}}</p>
 <p v-if="notice" role="status" class="alert ok">{{notice}}</p>
 <ElDialog :model-value="addOpen" title="添加允许访问的 IP" width="620px" class="business-modal form-panel" destroy-on-close :close-on-click-modal="false" @close="!busy&&(addOpen=false)">
  <ElForm ref="formRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="add">
   <ElFormItem label="IP 地址" prop="ip" :rules="[{required:true,message:'请输入 IP 地址',trigger:'blur'}]">
    <ElInput v-model.trim="form.ip" aria-label="IP 地址" placeholder="例如 192.168.1.105 或 2001:db8::1"/>
   </ElFormItem>
   <ElFormItem label="设备 / 用途备注" prop="note">
    <ElInput v-model.trim="form.note" aria-label="设备 / 用途备注" placeholder="例如 运检班组办公电脑"/>
   </ElFormItem>
   <div class="wide form-actions">
    <ElButton @click="addOpen=false">取消</ElButton>
    <ElButton native-type="submit" class="primary" :disabled="busy">添加允许 IP</ElButton>
   </div>
  </ElForm>
 </ElDialog>
 <ElDialog :model-value="!!pendingRemove" title="移除 IP 访问权限" width="620px" class="business-modal form-panel" :close-on-click-modal="false" @close="!busy&&(pendingRemove=null)">
  <p>确定撤销 <strong class="mono">{{pendingRemove?.ip}}</strong> 的访问授权吗？撤销后，新连接将立即被拒绝。</p>
  <div class="form-actions"><ElButton @click="pendingRemove=null">取消</ElButton><ElButton class="primary" :disabled="busy" @click="remove">确认移除</ElButton></div>
 </ElDialog>
 <div class="table-wrap">
  <ElTable v-loading="loading" :data="entries" empty-text="目前没有授权任何远程 IP，仅服务器本机可以访问">
   <ElTableColumn prop="ip" label="允许的IP" min-width="160"/>
   <ElTableColumn prop="note" label="设备备注" min-width="140"/>
   <ElTableColumn prop="created_at" label="添加时间" min-width="180"/>
   <ElTableColumn prop="created_by_name" label="添加人" min-width="125"/>
   <ElTableColumn label="操作" width="110"><template #default="{row}"><ElButton class="link danger" @click="pendingRemove=entries.find(e=>e.id===row.id)||null">移除</ElButton></template></ElTableColumn>
  </ElTable>
 </div>
 <p class="muted minor">只允许精确 IP 地址，不允许填网段、IP 范围或域名。验证使用真实 TCP 连接地址，不相信浏览器传入的代理头。IP 授权不能替代账号登录；Windows 防火墙仍需单独放行服务端口。</p>
</section>
</template>
