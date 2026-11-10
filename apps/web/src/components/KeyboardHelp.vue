<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue';
import {useRoute} from 'vue-router';
import {X} from 'lucide-vue-next';
const emit=defineEmits<{close:[]}>(),route=useRoute(),dialog=ref<HTMLElement>();let previous:HTMLElement|null=null;
const entries=computed(()=>{
  const rows=[['Ctrl / ⌘ + K','搜索项目（其他对话框打开时不会触发）'],['Tab / Shift + Tab','在可操作控件间移动；Enter 或空格激活按钮'],['Esc','关闭当前支持关闭的面板或取消单元格编辑']];
  if(route.path.endsWith('/table'))rows.push(['序号按钮 + Enter','打开或切换样本详情；正文可选取复制'],['单元格双击 → Enter','核对类型后将内容加入私有草稿，不提交分支'],['Shift + Enter','在文本单元格编辑器中换行']);
  if(route.query.section==='fields')rows.push(['Alt + ↑ / ↓','移动当前字段；也可使用上下按钮或拖动手柄']);
  return rows;
});
function close(){emit('close');}
function keydown(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key!=='Tab')return;const controls=[...dialog.value?.querySelectorAll<HTMLElement>('button,a[href]')??[]],first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
onMounted(async()=>{previous=document.activeElement as HTMLElement;await nextTick();dialog.value?.querySelector<HTMLElement>('button')?.focus();});onBeforeUnmount(()=>previous?.isConnected&&previous.focus({preventScroll:true}));
</script>
<template><div class="modal-backdrop" @click.self="close" @keydown="keydown"><section ref="dialog" class="modal keyboard-help" role="dialog" aria-modal="true" aria-labelledby="keyboard-title"><header class="panel-header"><div><h2 id="keyboard-title">当前页面的操作帮助</h2><p>输入框中的文字和换行遵循控件提示；不会通过快捷键自动提交分支。</p></div><button class="icon-button" aria-label="关闭操作帮助" @click="close"><X :size="18"/></button></header><dl><template v-for="[key,meaning] in entries" :key="key"><dt><kbd>{{key}}</kbd></dt><dd>{{meaning}}</dd></template></dl><p class="notice">“输入已保留”是本机原始表单，“私有草稿已保存”仍未提交；只有明确提交后才形成分支版本。绿色表示本轮提交成功，不表示通过复核。</p></section></div></template>
<style scoped>.keyboard-help{width:min(680px,96vw)}.keyboard-help dl{display:grid;grid-template-columns:minmax(120px,1fr) 2fr;gap:18px 20px;margin:24px 0;line-height:1.8}.keyboard-help dd{margin:0;color:var(--muted)}.keyboard-help kbd{font-size:12px;white-space:normal}.keyboard-help .notice{font-size:12px}@media(max-width:520px){.keyboard-help dl{grid-template-columns:1fr;gap:8px}.keyboard-help dd{margin-bottom:12px}}</style>
