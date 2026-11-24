<!-- Adapted from vue3-element-admin 4.13.0 src/layouts/components/LayoutMain.vue.
     The route view remains controlled by the existing project app and its draft guard. -->
<template>
  <section class="layout-content"><slot /></section>
</template>
<style scoped>
.layout-content{position:relative;min-width:0;min-height:calc(100vh - 110px);
  background-color:var(--page-bg)}
</style>
