<script setup lang="ts">
import {ref} from 'vue';
import {ElForm,ElFormItem,ElInput,ElButton,type FormInstance} from 'element-plus';
const props=defineProps<{username:string,password:string,busy:boolean,error:string}>();
const emit=defineEmits<{(e:'update:username',value:string):void;(e:'update:password',value:string):void;(e:'login'):void}>();
const formRef=ref<FormInstance>();
async function submit(){
 if(props.busy)return;
 const valid=await formRef.value?.validate().catch(()=>false);
 if(valid)emit('login');
}
</script>
<template>
 <div class="auth-bg"><div class="auth-card">
  <div class="logo">SD</div>
  <h1>输电项目全流程管理</h1>
  <p class="muted">使用本地服务器账号登录</p>
  <ElForm ref="formRef" :model="{username,password}" label-position="top" novalidate @submit.prevent="submit">
   <ElFormItem label="用户名" prop="username" :rules="[{required:true,message:'请输入用户名',trigger:'blur'}]">
    <ElInput aria-label="用户名" :model-value="username" autocomplete="username" placeholder="输入用户名" @update:model-value="value=>emit('update:username',value)"/>
   </ElFormItem>
   <ElFormItem label="密码" prop="password" :rules="[{required:true,message:'请输入密码',trigger:'blur'}]">
    <ElInput aria-label="密码" :model-value="password" type="password" autocomplete="current-password" placeholder="输入密码" @update:model-value="value=>emit('update:password',value)"/>
   </ElFormItem>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <ElButton native-type="submit" class="primary full" :disabled="busy">登录系统</ElButton>
  </ElForm>
  <p class="minor">首次部署请在服务器运行「初始化管理员.cmd」</p>
 </div></div>
</template>
