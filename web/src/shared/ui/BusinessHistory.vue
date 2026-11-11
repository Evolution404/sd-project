<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import type { Actor } from "../../../../server/shared/types/contracts";
import type { CatalogKind, CatalogFormDefinition } from "../../../../server/shared/types/catalog";
import { fieldName, factText, visibleFact } from "../utils/display";
const props = defineProps<{ value: unknown }>();
const labels = ref<Record<string, string>>({}),
  actors = ref<Record<string, string>>({});
const sections = computed(() =>
  Array.isArray(props.value)
    ? [["versions", props.value]]
    : Object.entries((props.value || {}) as Record<string, unknown>),
);
const records = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value];
onMounted(async () => {
  const [definitions, people, businessLabels] = await Promise.all([
    api<Record<CatalogKind, CatalogFormDefinition>>("/catalogs"),
    api<Actor[]>("/actors?history=true"),
    api<Record<string,string>>("/display-labels"),
  ]);
  for (const definition of Object.values(definitions))
    for (const field of [...definition.rootFields, ...definition.fields])
      labels.value[field.key] = field.label;
  Object.assign(labels.value, businessLabels);
  actors.value = Object.fromEntries(
    people.map((person) => [person.id, person.username]),
  );
});
</script>
<template>
  <ElCollapse>
    <ElCollapseItem
      v-for="[key, section] in sections"
      :key="String(key)"
      :title="fieldName(String(key))"
      :name="String(key)"
    >
      <ElEmpty
        v-if="Array.isArray(section) && !section.length"
        description="暂无历史记录"
      />
      <div
        v-for="(record, index) in records(section)"
        :key="index"
        class="panel"
      >
        <ElDescriptions
          v-if="record && typeof record === 'object'"
          :column="1"
          border
        >
          <ElDescriptionsItem
            v-for="[field, value] in Object.entries(record).filter(([field]) =>
              visibleFact(field),
            )"
            :key="field"
            :label="fieldName(field, labels)"
            >{{ factText(value, field, labels, actors) }}</ElDescriptionsItem
          >
        </ElDescriptions>
        <p v-else>{{ factText(record) }}</p>
      </div>
    </ElCollapseItem>
  </ElCollapse>
</template>
