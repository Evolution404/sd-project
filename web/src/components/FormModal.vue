<script setup lang="ts">
import {nextTick,ref,watch} from 'vue';
const props = withDefaults(defineProps<{open:boolean,title:string,description?:string,error?:string,size?:'normal'|'wide'}>(),{size:'normal'});
const emit=defineEmits<{close:[]}>();
const panel=ref<HTMLElement|null>(null);
let former:HTMLElement|null=null;
function onKey(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close');return}
 if(event.key!=='Tab'||!panel.value)return;
 const focusable=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
 .filter(el=>el.getClientRects().length>0);
 if(!focusable.length){event.preventDefault();return}
 if(event.shiftKey&&(document.activeElement===focusable[0]||document.activeElement===panel.value)){
  event.preventDefault();focusable[focusable.length-1].focus();
 } else if(!event.shiftKey&&document.activeElement===focusable[focusable.length-1]){
  event.preventDefault();focusable[0].focus()
 }
}
watch(()=>props.open,async open=>{
 if(open){
  former=document.activeElement instanceof HTMLElement?document.activeElement:null;
  await nextTick();
  (panel.value?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')||panel.value)?.focus();
 }else{former?.focus();former=null}
},{flush:'post'});
</script>
<template>
 <Teleport to="body">
  <div v-if="open" class="form-modal-backdrop" @mousedown.self="emit('close')">
   <section ref="panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" :class="['form-modal-dialog','form-panel',{'form-modal-wide':size==='wide'}]" @keydown="onKey">
    <div class="form-modal-header">
     <div><h2>{{title}}</h2><p v-if="description">{{description}}</p></div>
     <button type="button" class="form-modal-close" aria-label="关闭弹窗" @click="emit('close')">×</button>
    </div>
    <div class="form-modal-content"><p v-if="error" class="form-modal-error" role="alert">{{error}}</p><slot/></div>
   </section>
  </div>
 </Teleport>
</template>
