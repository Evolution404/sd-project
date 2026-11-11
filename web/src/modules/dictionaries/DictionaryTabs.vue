<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
const route = useRoute(),
  router = useRouter();
const kind = computed(() => String(route.params.kind || "voltages"));
function select(value: string | number) {
  if (value !== kind.value)
    void router.push({
      name: "dictionaries",
      params: { kind: String(value) },
      query: typeof route.query.returnTo === "string" ? { returnTo: route.query.returnTo } : {},
    });
}
</script>
<template>
  <ElTabs :model-value="kind" @tab-change="select"
    ><ElTabPane name="voltages" label="电压等级" /><ElTabPane
      name="units"
      label="计量单位" /><ElTabPane
      name="priorities"
      label="优先级" /><ElTabPane
      name="categories"
      label="项目类别" /><ElTabPane name="organizations" label="归口单位"
  /></ElTabs>
</template>
