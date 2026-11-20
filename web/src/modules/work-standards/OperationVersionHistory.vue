<script setup lang="ts">
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
defineProps<{ id: string }>();
</script>

<template>
  <BusinessHistory record-kind="operations" :record-id="id" />
</template>
