<script setup lang="ts">
import {ElDialog} from 'element-plus';
withDefaults(defineProps<{
 open:boolean;title:string;description?:string;error?:string;size?:'normal'|'wide'
}>(),{size:'normal'});
const emit=defineEmits<{close:[]}>();
</script>
<template>
 <ElDialog :model-value="open" :title="title" :width="size==='wide'?'860px':'620px'"
  class="business-modal form-panel" :class="{'business-modal-wide':size==='wide'}"
  :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true"
  :lock-scroll="false" @close="emit('close')">
  <p v-if="description" class="muted">{{description}}</p>
  <p v-if="error" class="form-modal-error" role="alert">{{error}}</p>
  <slot/>
 </ElDialog>
</template>
<style>
.business-modal.el-dialog{max-width:calc(100vw - 48px);border-radius:13px;padding:0;box-shadow:0 20px 70px #1a29422e}
.business-modal .el-dialog__header{display:flex;align-items:center;padding:20px 25px;border-bottom:1px solid var(--line,#dfe5ec)}
.business-modal .el-dialog__title{font-size:19px;font-weight:650;color:var(--green,#3478f6)}
.business-modal .el-dialog__body{padding:24px 25px;max-height:calc(100vh - 170px);overflow:auto;overscroll-behavior:contain}
.business-modal .form-actions{display:flex;justify-content:flex-end;gap:10px}
.business-modal .form-modal-error{color:#b4403a;font-size:12px;margin:0 0 12px}
</style>
