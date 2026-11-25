<!-- Port of the outer CrudTable structure in vue3-element-admin v4.13.0.
     Its upstream pagination/search are separate; business grid remains native Tabulator. MIT. -->
<template>
  <div class="youlai-crud-surface">
    <div v-if="$slots.toolbar" class="youlai-crud-toolbar"><slot name="toolbar"/></div>
    <slot/>
    <div v-if="$slots.pagination" class="youlai-crud-pagination"><slot name="pagination"/></div>
  </div>
</template>
<style scoped>
.youlai-crud-surface{display:flex;flex:1;flex-direction:column;min-width:0;
  background:var(--content-bg);border:1px solid var(--card-border);
  border-radius:var(--card-radius);box-shadow:var(--card-shadow);padding:16px}
.youlai-crud-toolbar{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:10px;margin-bottom:12px}
.youlai-crud-pagination{margin-top:auto}
@media(max-width:960px){.youlai-crud-surface{padding:12px}}
</style>
