<script setup lang="ts">
defineProps<{open:boolean}>();
</script>
<template>
 <span class="nav-chevron" aria-hidden="true">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" :class="{expanded:open}" focusable="false">
   <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
 </span>
</template>
<style scoped>
svg{display:block;transform:rotate(0deg);transform-origin:50% 50%;transition:transform .12s ease}
svg.expanded{transform:rotate(90deg)}
</style>
