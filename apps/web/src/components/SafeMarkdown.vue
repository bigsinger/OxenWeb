<script setup lang="ts">
import { computed, defineComponent, Fragment, h } from 'vue';
const props=defineProps<{source:string}>();
type Block={type:'heading'|'paragraph'|'quote'|'list'|'code'|'rule';text:string;level?:number;lines?:string[]};
const blocks=computed(()=>{
  const result:Block[]=[],lines=props.source.slice(0,200000).replace(/\r\n/g,'\n').split('\n');let index=0;
  while(index<lines.length){const line=lines[index++]!;if(!line.trim())continue;
    if(/^\s*```/.test(line)){const code:string[]=[];while(index<lines.length&&!/^\s*```/.test(lines[index]!))code.push(lines[index++]!);index++;result.push({type:'code',text:code.join('\n')});continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){result.push({type:'heading',level:heading[1]!.length,text:heading[2]!});continue;}
    if(/^\s*([-*_])\1\1+\s*$/.test(line)){result.push({type:'rule',text:''});continue;}
    if(/^\s*>\s?/.test(line)){const quote=[line.replace(/^\s*>\s?/,'')];while(index<lines.length&&/^\s*>/.test(lines[index]!))quote.push(lines[index++]!.replace(/^\s*>\s?/,''));result.push({type:'quote',text:quote.join('\n')});continue;}
    if(/^\s*(?:[-*+] |\d+\. )/.test(line)){const list=[line.replace(/^\s*(?:[-*+] |\d+\. )/,'')];while(index<lines.length&&/^\s*(?:[-*+] |\d+\. )/.test(lines[index]!))list.push(lines[index++]!.replace(/^\s*(?:[-*+] |\d+\. )/,''));result.push({type:'list',text:'',lines:list});continue;}
    const paragraph=[line];while(index<lines.length&&lines[index]!.trim()&&!/^(#{1,6}\s|\s*```|\s*>|\s*[-*+] )/.test(lines[index]!))paragraph.push(lines[index++]!);result.push({type:'paragraph',text:paragraph.join('\n')});
  }return result;
});
// Render through Vue text nodes. Raw HTML, embedded media and javascript URLs are never evaluated.
const Inline=defineComponent({props:{text:{type:String,required:true}},setup(p){return()=>h(Fragment,p.text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g).map(part=>{
  if(part.startsWith('**')&&part.endsWith('**'))return h('strong',part.slice(2,-2));
  if(part.startsWith('`')&&part.endsWith('`'))return h('code',part.slice(1,-1));
  const match=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);if(match){try{const url=new URL(match[2]!);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return h('a',{href:url.href,target:'_blank',rel:'noopener noreferrer'},match[1]);}catch{/* repository-relative references remain literal text */}}
  return part;
}));}});
</script>
<template><article class="safe-markdown"><template v-for="(block,index) in blocks" :key="index"><component :is="'h'+Math.min((block.level??1)+1,6)" v-if="block.type==='heading'"><Inline :text="block.text"/></component><pre v-else-if="block.type==='code'"><code>{{block.text}}</code></pre><ul v-else-if="block.type==='list'"><li v-for="(line,i) in block.lines" :key="i"><Inline :text="line"/></li></ul><blockquote v-else-if="block.type==='quote'"><Inline :text="block.text"/></blockquote><hr v-else-if="block.type==='rule'"/><p v-else><Inline :text="block.text"/></p></template><p v-if="source.length>200000" class="notice">说明较长，此处展示前 200,000 个字符；完整内容保留在版本文件中。</p></article></template>
<style scoped>
.safe-markdown{font-size:14px;line-height:1.85;color:var(--text);overflow-wrap:anywhere}.safe-markdown :is(h2,h3,h4,h5,h6){margin:25px 0 12px;font-weight:600;line-height:1.5}.safe-markdown h2{font-size:23px;border-bottom:1px solid var(--line);padding-bottom:12px}.safe-markdown h3{font-size:19px}.safe-markdown p{margin:13px 0;white-space:pre-wrap}.safe-markdown ul{padding-left:24px;margin:14px 0;list-style:disc}.safe-markdown li{padding:3px 0}.safe-markdown blockquote{border-left:3px solid var(--primary);padding:7px 17px;margin:16px 0;background:var(--surface-raised);color:var(--muted)}.safe-markdown pre{padding:17px;border:1px solid var(--line);background:var(--bg);border-radius:6px;overflow:auto;max-height:550px;font-size:12px;line-height:1.7}.safe-markdown :deep(code){font-family:var(--font-mono,monospace);font-size:.9em;background:var(--surface-raised);border-radius:3px;padding:2px 4px}.safe-markdown pre code{padding:0;background:transparent}.safe-markdown :deep(a){color:var(--accent);text-decoration:underline;text-underline-offset:3px}.safe-markdown hr{border:0;border-top:1px solid var(--line);margin:25px 0}.safe-markdown>:first-child{margin-top:0}
</style>
