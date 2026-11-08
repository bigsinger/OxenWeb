<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FileArchive, FileText, Folder, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-vue-next';
import { queryString, request } from '../api';

interface ArchiveEntry { name: string; type: 'file' | 'directory'; compressedSize: number; uncompressedSize: number }
interface ArchiveView { ref: string; commitId: string; path: string; sha256: string; size: number; totalUncompressedSize: number; entries: ArchiveEntry[]; selected?: { name: string; size: number; text: string; truncated: false } }
const props = defineProps<{ base: string; branch: string; path: string; compact?: boolean }>();
const archive = ref<ArchiveView>(), selected = ref<ArchiveView['selected']>(), selectedName = ref(''), search = ref('');
const loading = ref(false), reading = ref(false), error = ref(''), entryError = ref('');
const entries = computed(() => (archive.value?.entries ?? []).filter(entry => entry.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const fileCount = computed(() => archive.value?.entries.filter(entry => entry.type === 'file').length ?? 0);
let generation = 0, entryGeneration = 0, controller: AbortController | undefined, entryController: AbortController | undefined;
function bytes(value: number) { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`; }
function failure(cause: unknown) { return cause instanceof Error ? cause.message : '压缩包无法读取。'; }
async function load() {
  const current = ++generation; ++entryGeneration; controller?.abort(); entryController?.abort(); controller = new AbortController();
  archive.value = undefined; selected.value = undefined; selectedName.value = ''; error.value = ''; entryError.value = ''; search.value = ''; reading.value = false; loading.value = true;
  const context = { base: props.base, path: props.path, ref: props.branch };
  try {
    const value = await request<ArchiveView>(context.base + '/archive' + queryString({ ref: context.ref, path: context.path }), { signal: controller.signal });
    if (current !== generation) return;
    archive.value = value;
    const preferred = value.entries.find(entry => entry.type === 'file' && /(^|\/)SKILL\.md$/i.test(entry.name) && entry.uncompressedSize <= 256 * 1024);
    if (preferred) void readEntry(preferred);
  } catch (cause) { if (current === generation && !(cause instanceof Error && cause.name === 'AbortError')) error.value = failure(cause); }
  finally { if (current === generation) loading.value = false; }
}
async function readEntry(entry: ArchiveEntry) {
  const value = archive.value;
  if (!value || entry.type !== 'file' || entry.uncompressedSize > 256 * 1024) return;
  const current = ++entryGeneration, contextGeneration = generation; entryController?.abort(); entryController = new AbortController();
  selectedName.value = entry.name; selected.value = undefined; entryError.value = ''; reading.value = true;
  try {
    // Pin member requests to the manifest's commit, even if the branch changes upstream.
    const result = await request<ArchiveView>(props.base + '/archive' + queryString({ ref: value.commitId, path: value.path, entry: entry.name }), { signal: entryController.signal });
    if (current !== entryGeneration || contextGeneration !== generation) return;
    if (result.commitId !== value.commitId || result.sha256 !== value.sha256 || result.selected?.name !== entry.name) throw new Error('压缩包版本不一致，请重新加载清单。');
    selected.value = result.selected;
  } catch (cause) { if (current === entryGeneration && contextGeneration === generation && !(cause instanceof Error && cause.name === 'AbortError')) entryError.value = failure(cause); }
  finally { if (current === entryGeneration && contextGeneration === generation) reading.value = false; }
}
watch(() => [props.base, props.branch, props.path], load, { immediate: true });
onBeforeUnmount(() => { ++generation; ++entryGeneration; controller?.abort(); entryController?.abort(); });
</script>

<template>
  <section class="archive-preview" :class="{ compact }" aria-label="ZIP 压缩包只读查看">
    <div v-if="loading" class="archive-state" role="status"><LoaderCircle :size="22" class="spin" /><span>正在读取压缩包清单…</span></div>
    <div v-else-if="error" class="archive-state archive-error" role="alert"><FileArchive :size="26" /><strong>无法查看压缩包</strong><p>{{ error }}</p><button class="btn btn-secondary" @click="load"><RefreshCw :size="14" />重试</button></div>
    <template v-else-if="archive">
      <header class="archive-heading"><div><FileArchive :size="20" /><strong>压缩包内容</strong><span>{{ fileCount }} 个文件 · {{ bytes(archive.size) }}</span></div><button class="btn btn-ghost" aria-label="重新加载压缩包" @click="load"><RefreshCw :size="15" /></button></header>
      <div class="archive-context"><span><ShieldCheck :size="14" />只读查看 · 不解压到磁盘、不执行文件</span><code :title="archive.commitId">版本 {{ archive.commitId.slice(0, 10) }}</code></div>
      <div class="archive-layout">
        <aside class="archive-directory" aria-label="压缩包文件清单"><label class="archive-search"><Search :size="14" /><input v-model="search" aria-label="筛选压缩包路径" placeholder="筛选文件路径…" /></label><div class="entry-count">{{ entries.length }} / {{ archive.entries.length }} 个条目 · 展开 {{ bytes(archive.totalUncompressedSize) }}</div>
          <div class="archive-entries"><button v-for="entry in entries" :key="entry.name" :class="['archive-entry', { active: selectedName === entry.name }]" :disabled="entry.type === 'directory' || entry.uncompressedSize > 256 * 1024" :title="entry.uncompressedSize > 256 * 1024 ? '条目超过 256 KiB 文本预览上限' : entry.name" :aria-pressed="entry.type === 'file' ? selectedName === entry.name : undefined" @click="readEntry(entry)"><Folder v-if="entry.type === 'directory'" :size="15" /><FileText v-else :size="15" /><span>{{ entry.name }}</span><small>{{ entry.type === 'directory' ? '目录' : bytes(entry.uncompressedSize) }}</small></button><p v-if="!entries.length" class="no-entries">{{ search ? '没有匹配的文件路径' : '压缩包为空' }}</p></div>
        </aside>
        <div class="archive-content" :aria-busy="reading"><header v-if="selectedName" class="member-heading"><strong>{{ selectedName }}</strong><span>UTF-8 纯文本</span></header><div v-if="reading" class="archive-state" role="status"><LoaderCircle :size="20" class="spin" /><span>正在校验并读取条目…</span></div><div v-else-if="entryError" class="archive-state archive-error" role="alert"><FileText :size="24" /><p>{{ entryError }}</p></div><pre v-else-if="selected" class="archive-text" tabindex="0" :aria-label="selected.name + ' 纯文本内容'">{{ selected.text || '（空文件）' }}</pre><div v-else class="archive-state"><FileText :size="28" /><strong>选择文件查看内容</strong><p>支持 256 KiB 以内的 UTF-8 文本。脚本、Markdown 和 HTML 均仅显示原文。</p></div></div>
      </div>
      <footer class="archive-footer"><span>SHA-256</span><code>{{ archive.sha256 }}</code></footer>
    </template>
  </section>
</template>

<style scoped>
.archive-preview{background:var(--surface);color:var(--text);min-width:0}.archive-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}.archive-heading>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.archive-heading strong{font-size:14px;font-weight:600}.archive-heading span{font-size:12px;color:var(--muted)}.archive-context{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 18px;background:var(--surface-raised);font-size:11px;color:var(--muted);border-bottom:1px solid var(--line)}.archive-context>span{display:flex;align-items:center;gap:7px}.archive-context code{font-size:11px}.archive-layout{display:grid;grid-template-columns:minmax(220px,32%) minmax(0,1fr);min-height:360px}.archive-directory{min-width:0;border-right:1px solid var(--line);background:var(--bg)}.archive-search{display:flex;align-items:center;gap:8px;padding:8px 10px;margin:12px;border:1px solid var(--line);border-radius:5px;color:var(--muted);background:var(--surface)}.archive-search input{min-width:0;width:100%;font-size:12px;background:transparent;border:0;outline:none;color:var(--text)}.archive-search:focus-within{border-color:var(--primary)}.entry-count{padding:0 12px 10px;font-size:10px;color:var(--muted)}.archive-entries{max-height:540px;overflow:auto;padding:0 6px 10px}.archive-entry{display:flex;align-items:flex-start;gap:8px;padding:10px 8px;width:100%;text-align:left;color:var(--text);font-size:12px;border:1px solid transparent;border-radius:5px}.archive-entry>svg{flex-shrink:0;color:var(--muted);margin-top:1px}.archive-entry>span{overflow-wrap:anywhere;min-width:0;flex:1}.archive-entry small{flex-shrink:0;color:var(--muted);font-size:10px;white-space:nowrap;padding-top:2px}.archive-entry:not(:disabled):hover{background:var(--surface-raised)}.archive-entry.active{background:color-mix(in srgb,var(--primary) 13%,var(--surface));border-color:color-mix(in srgb,var(--primary) 45%,var(--line))}.archive-entry.active>svg{color:var(--primary-hover)}.archive-entry:disabled{cursor:default;color:var(--muted)}.archive-entry:disabled>svg{opacity:.55}.no-entries{padding:22px 12px;font-size:12px;color:var(--muted);text-align:center}.archive-content{min-width:0;background:var(--surface)}.member-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border-bottom:1px solid var(--line)}.member-heading strong{font-size:12px;font-weight:500;overflow-wrap:anywhere;min-width:0}.member-heading span{color:var(--muted);font-size:10px;white-space:nowrap}.archive-text{padding:18px;margin:0;max-height:540px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.85 Consolas,monospace;color:var(--text);background:var(--bg);tab-size:2}.archive-state{min-height:300px;padding:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;color:var(--muted);font-size:13px}.archive-state strong{font-size:14px;color:var(--text);font-weight:500}.archive-state p{max-width:420px;font-size:12px;line-height:1.8;overflow-wrap:anywhere;margin:0}.archive-error p{color:var(--danger)}.archive-footer{display:flex;gap:12px;padding:12px 18px;border-top:1px solid var(--line);color:var(--muted);font-size:10px}.archive-footer span{flex-shrink:0}.archive-footer code{overflow-wrap:anywhere;min-width:0;font-size:10px}.compact .archive-layout{grid-template-columns:minmax(190px,35%) minmax(0,1fr)}@media(max-width:700px){.archive-layout,.compact .archive-layout{grid-template-columns:1fr}.archive-directory{border-right:0;border-bottom:1px solid var(--line)}.archive-entries{max-height:220px}.archive-content .archive-state{min-height:220px}.archive-heading{padding:13px}.archive-context{padding:10px 13px}.member-heading{padding:12px}.archive-text{padding:13px;max-height:420px}.archive-footer{padding:12px 13px}}
</style>
