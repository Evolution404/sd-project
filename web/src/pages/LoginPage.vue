<script setup lang="ts">
import {ElForm,ElInput,ElButton} from 'element-plus';
import {vFormValidation} from '../utils/form-validation';
defineProps<{username:string,password:string,busy:boolean,error:string}>();
const emit=defineEmits<{(e:'update:username',value:string):void;(e:'update:password',value:string):void;(e:'login'):void}>();
</script>
<template>
<div class="auth-bg"><div class="auth-card"><div class="logo">SD</div><h1>输电项目全流程管理</h1><p class="muted">使用本地服务器账号登录</p><ElForm v-form-validation novalidate @submit.prevent="emit('login')"><label><span class="field-caption">用户名</span><ElInput :model-value="username" @update:model-value="value=>emit('update:username',value)" autocomplete="username" required placeholder="输入用户名"/></label><label><span class="field-caption">密码</span><ElInput :model-value="password" @update:model-value="value=>emit('update:password',value)" type="password" autocomplete="current-password" required placeholder="输入密码"/></label><p v-if="error" class="error">{{error}}</p><ElButton native-type="submit" class="primary full" :disabled="busy">登录系统</ElButton></ElForm><p class="minor">首次部署请在服务器运行「初始化管理员.cmd」</p></div></div>
</template>
