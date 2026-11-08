<script setup lang="ts">
import { computed, ref } from 'vue';
import { Info } from 'lucide-vue-next';
import { datasetValueType, resolveDatasetFieldMetadata, type DatasetFieldMetadata } from '../../../../packages/shared/src/field-metadata';

const props = defineProps<{ record: Record<string, unknown>; fields?: Readonly<Record<string, DatasetFieldMetadata>> }>();
const expanded = ref<Record<string, boolean>>(Object.create(null));
const defaultOpen = new Set(['text', 'title', 'user_query', 'original_goal']);
const entries = computed(() => Object.entries(props.record).map(([id, value]) => ({
  ...resolveDatasetFieldMetadata(id, props.fields), value, type: datasetValueType(value),
})));
const isOpen = (id: string) => expanded.value[id] ?? defaultOpen.has(id);
function toggle(id: string, event: Event) { expanded.value[id] = (event.target as HTMLDetailsElement).open; }
function content(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
</script>

<template>
  <div class="dataset-source-fields">
    <details v-for="field in entries" :key="field.id" :open="isOpen(field.id)" @toggle="toggle(field.id, $event)">
      <summary :title="field.description">
        <span class="source-field-names"><code>{{ field.id }}</code><span v-if="field.displayName" class="source-field-alias">{{ field.displayName }}</span></span>
        <small class="source-field-type">{{ field.type }}</small>
        <span v-if="field.description" class="source-field-help" tabindex="0" role="note" :aria-label="`${field.id} 字段说明：${field.description}`" :title="field.description" @click.stop.prevent @keydown.enter.stop.prevent @keydown.space.stop.prevent>
          <Info :size="13" aria-hidden="true"/><span class="source-field-tooltip" role="tooltip">{{ field.description }}</span>
        </span>
      </summary>
      <pre v-if="isOpen(field.id)">{{ content(field.value) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.dataset-source-fields{min-width:0;padding:0 18px 18px}.dataset-source-fields>details{border-bottom:1px solid var(--line);min-width:0}.dataset-source-fields summary{position:relative;display:flex;align-items:center;gap:9px;min-height:43px;padding:11px 0;color:var(--text);cursor:pointer;list-style:none}.dataset-source-fields summary::-webkit-details-marker{display:none}.dataset-source-fields summary::before{content:'›';color:var(--subtle);font-size:17px;line-height:1;transform:rotate(0deg);transition:transform .12s}.dataset-source-fields details[open]>summary::before{transform:rotate(90deg)}.source-field-names{display:flex;align-items:baseline;flex-wrap:wrap;gap:7px;min-width:0;flex:1}.source-field-names code{font-size:11px;color:var(--text);overflow-wrap:anywhere}.source-field-alias{font-size:11px;color:var(--muted)}.source-field-type{font-size:10px;color:var(--subtle);flex-shrink:0}.source-field-help{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--subtle);cursor:help;border-radius:3px}.source-field-help:focus-visible{outline:2px solid var(--primary);outline-offset:3px}.source-field-tooltip{display:none;position:absolute;right:-2px;bottom:calc(100% + 9px);z-index:75;width:max-content;max-width:min(280px,calc(100vw - 70px));padding:9px 11px;background:var(--surface-raised);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 7px 22px #0005;color:var(--text);font-size:11px;font-weight:400;line-height:1.65;white-space:normal;overflow-wrap:anywhere;pointer-events:none}.source-field-help:hover>.source-field-tooltip,.source-field-help:focus-visible>.source-field-tooltip{display:block}.dataset-source-fields pre{margin:0 0 13px;padding:11px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg);white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.8;color:var(--text);max-height:400px;overflow:auto}.dataset-source-fields summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:3px}@media(max-width:720px){.dataset-source-fields{padding:0 14px 14px}}
@media(max-width:950px){.dataset-source-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}}
@media(max-width:600px){.dataset-source-fields{grid-template-columns:1fr}}
</style>
