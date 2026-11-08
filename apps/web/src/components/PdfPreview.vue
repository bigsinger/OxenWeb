<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, Expand, LoaderCircle, Minus, Plus, RefreshCw } from 'lucide-vue-next';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const props = defineProps<{ url: string }>();
const canvas = ref<HTMLCanvasElement | null>(null), viewportElement = ref<HTMLElement | null>(null);
const page = ref(1), totalPages = ref(0), scale = ref(1), fit = ref(true);
const loading = ref(true), rendering = ref(false), error = ref('');
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
let pdf: PDFDocumentProxy | null = null;
let loadingTask: PDFDocumentLoadingTask | null = null;
let renderTask: RenderTask | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let loadGeneration = 0, renderGeneration = 0, disposed = false;
let resizeObserver: ResizeObserver | null = null;

function message(cause: unknown) {
  if (cause instanceof Error && cause.name === 'PasswordException') return '此 PDF 受密码保护，请在本地阅读器中打开。';
  return cause instanceof Error ? cause.message : 'PDF 无法加载或渲染。';
}
async function releaseDocument() {
  ++renderGeneration;
  renderTask?.cancel();
  const previousLoadingTask = loadingTask, previousPdf = pdf, previousRender = renderQueue;
  loadingTask = null; pdf = null;
  await previousRender.catch(() => {});
  if (previousLoadingTask) await previousLoadingTask.destroy().catch(() => {});
  else if (previousPdf) await previousPdf.loadingTask.destroy().catch(() => {});
}
function renderPage(): Promise<void> {
  const generation = ++renderGeneration;
  renderTask?.cancel();
  rendering.value = true;
  // Await the cancelled render before resizing or drawing to the same canvas.
  renderQueue = renderQueue.catch(() => {}).then(async () => {
    if (disposed || generation !== renderGeneration || !pdf || !canvas.value) return;
    let pdfPage: PDFPageProxy | null = null;
    try {
      pdfPage = await pdf.getPage(page.value);
      if (disposed || generation !== renderGeneration || !canvas.value) return;
      const unitViewport = pdfPage.getViewport({ scale: 1 });
      if (fit.value && viewportElement.value) scale.value = Math.min(3, Math.max(.25, (viewportElement.value.clientWidth - 40) / unitViewport.width));
      const viewport = pdfPage.getViewport({ scale: scale.value });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const element = canvas.value, context = element.getContext('2d');
      if (!context) throw new Error('当前浏览器无法创建 PDF 画布。');
      element.width = Math.ceil(viewport.width * outputScale);
      element.height = Math.ceil(viewport.height * outputScale);
      element.style.width = `${Math.ceil(viewport.width)}px`;
      element.style.height = `${Math.ceil(viewport.height)}px`;
      error.value = '';
      const task = pdfPage.render({
        canvas: element, canvasContext: context, viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTask = task;
      await task.promise;
      if (renderTask === task) renderTask = null;
    } catch (cause) {
      if (!disposed && generation === renderGeneration && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) error.value = message(cause);
    } finally {
      pdfPage?.cleanup();
      if (!disposed && generation === renderGeneration) { rendering.value = false; renderTask = null; }
    }
  });
  return renderQueue;
}
async function load() {
  const generation = ++loadGeneration;
  loading.value = true; error.value = ''; totalPages.value = 0; page.value = 1; fit.value = true;
  await releaseDocument();
  if (disposed || generation !== loadGeneration) return;
  try {
    const task = getDocument({ url: props.url, withCredentials: true, useSystemFonts: true });
    loadingTask = task;
    const document = await task.promise;
    if (disposed || generation !== loadGeneration) { await task.destroy().catch(() => {}); return; }
    pdf = document; totalPages.value = document.numPages;
    await nextTick();
    await renderPage();
  } catch (cause) { if (!disposed && generation === loadGeneration) error.value = message(cause); }
  finally { if (!disposed && generation === loadGeneration) loading.value = false; }
}
function goToPage(value: number) {
  if (!Number.isFinite(value) || !totalPages.value) return;
  const next = Math.max(1, Math.min(totalPages.value, Math.trunc(value)));
  if (next === page.value) return;
  page.value = next; void renderPage();
  viewportElement.value?.scrollTo({ top: 0, left: 0 });
}
function changePage(event: Event) { const input = event.target as HTMLInputElement; goToPage(Number(input.value)); input.value = String(page.value); }
function zoom(delta: number) { fit.value = false; scale.value = Math.max(.25, Math.min(3, Math.round((scale.value + delta) * 100) / 100)); void renderPage(); }
function fitWidth() { fit.value = true; void renderPage(); }
watch(() => props.url, () => { void load(); }, { immediate: true });
onMounted(() => {
  if (!viewportElement.value || !('ResizeObserver' in window)) return;
  let previousWidth = viewportElement.value.clientWidth;
  resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? previousWidth;
    if (Math.abs(width - previousWidth) < 1) return;
    previousWidth = width;
    if (fit.value && pdf && !loading.value) void renderPage();
  });
  resizeObserver.observe(viewportElement.value);
});
onBeforeUnmount(() => { disposed = true; ++loadGeneration; resizeObserver?.disconnect(); void releaseDocument(); });
</script>

<template>
  <section class="pdf-document" aria-label="PDF 文件预览">
    <div class="pdf-controls" role="toolbar" aria-label="PDF 翻页与缩放">
      <div class="pdf-page-controls">
        <button class="pdf-control" aria-label="PDF 上一页" :disabled="loading || page <= 1 || !totalPages" @click="goToPage(page - 1)"><ArrowLeft :size="15" /></button>
        <label class="pdf-page-label">第 <input :value="page" type="number" min="1" :max="totalPages || 1" aria-label="PDF 页码" :disabled="loading || !totalPages" @change="changePage" /> / {{ totalPages || '—' }} 页</label>
        <button class="pdf-control" aria-label="PDF 下一页" :disabled="loading || page >= totalPages || !totalPages" @click="goToPage(page + 1)"><ArrowRight :size="15" /></button>
      </div>
      <div class="pdf-zoom-controls">
        <button class="pdf-control" aria-label="缩小 PDF" :disabled="loading || !totalPages || scale <= .25" @click="zoom(-.25)"><Minus :size="15" /></button>
        <span class="pdf-scale" aria-live="polite">{{ zoomLabel }}</span>
        <button class="pdf-control" aria-label="放大 PDF" :disabled="loading || !totalPages || scale >= 3" @click="zoom(.25)"><Plus :size="15" /></button>
        <button class="pdf-control fit-width" :class="{ selected: fit }" :disabled="loading || !totalPages" @click="fitWidth"><Expand :size="14" /><span>适应宽度</span></button>
      </div>
    </div>
    <div ref="viewportElement" class="pdf-viewport" :aria-busy="loading || rendering">
      <div v-if="error" class="pdf-error" role="alert"><strong>PDF 预览失败</strong><p>{{ error }}</p><button class="btn btn-ghost" @click="load"><RefreshCw :size="14" /> 重试</button></div>
      <div v-else-if="loading" class="pdf-loading" role="status"><LoaderCircle class="spin" :size="23" /><span>正在渲染 PDF…</span></div>
      <span v-else-if="rendering" class="pdf-rendering" role="status"><LoaderCircle class="spin" :size="14" /> 正在渲染…</span>
      <canvas v-show="totalPages > 0 && !error" ref="canvas" class="pdf-canvas" role="img" :aria-label="`PDF 第 ${page} 页，共 ${totalPages} 页`">当前浏览器需要支持 Canvas 才能预览 PDF。</canvas>
    </div>
    <p v-if="totalPages && !error" class="pdf-caption">PDF · 第 {{ page }} / {{ totalPages }} 页</p>
  </section>
</template>

<style scoped>
.pdf-document{min-width:0;background:var(--bg)}.pdf-controls{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--surface-raised);color:var(--text);font-size:12px}.pdf-page-controls,.pdf-zoom-controls{display:flex;align-items:center;gap:8px}.pdf-control{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px;border:1px solid transparent;border-radius:5px;min-width:32px;min-height:32px;color:var(--muted);background:transparent}.pdf-control:hover:not(:disabled){background:var(--surface);border-color:var(--line);color:var(--text)}.pdf-control:disabled{opacity:.35;cursor:not-allowed}.pdf-control.selected{background:var(--surface);border-color:var(--line);color:var(--text)}.pdf-page-label{display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--muted)}.pdf-page-label input{width:48px;height:31px;text-align:center;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text);padding:2px;font-size:12px;appearance:textfield}.pdf-page-label input::-webkit-inner-spin-button{appearance:none}.pdf-scale{min-width:42px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.fit-width{margin-left:8px;padding:6px 9px;font-size:12px}.pdf-viewport{position:relative;overflow:auto;max-height:740px;min-height:380px;padding:26px;background:#111113;overscroll-behavior:contain}.pdf-canvas{display:block;margin:0 auto;max-width:none;background:#fff;box-shadow:0 3px 22px #0006}.pdf-loading{display:flex;align-items:center;justify-content:center;gap:11px;min-height:330px;font-size:13px;color:var(--muted)}.pdf-loading+.pdf-canvas{visibility:hidden;position:absolute;left:0;top:0}.pdf-rendering{position:sticky;top:0;left:0;display:flex;align-items:center;gap:7px;width:max-content;font-size:11px;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:5px;padding:8px 11px;margin:0 auto 8px;z-index:1}.pdf-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;min-height:330px;color:var(--danger);font-size:13px;text-align:center}.pdf-error p{max-width:500px;overflow-wrap:anywhere}.pdf-caption{padding:11px 16px;font-size:11px;color:var(--muted);text-align:center;border-top:1px solid var(--line);background:var(--surface)}
@media(max-width:640px){.pdf-controls{padding:10px;gap:8px}.pdf-control{padding:6px;min-width:30px}.pdf-page-label{font-size:11px}.pdf-zoom-controls{gap:4px}.fit-width{margin-left:2px}.fit-width span{display:none}.pdf-viewport{padding:16px;min-height:280px;max-height:70vh}.pdf-loading,.pdf-error{min-height:250px}}
</style>
