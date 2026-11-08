import { diffChars, diffLines, diffWordsWithSpace, type ChangeObject } from 'diff';

export interface DiffPart { text: string; changed: boolean }
export interface TextDiffLine { kind: 'context' | 'added' | 'removed'; text: string; oldLine?: number; newLine?: number; ending: 'LF' | 'CRLF' | '无换行'; parts: DiffPart[] }
export interface TextDiffHunk { header: string; lines: TextDiffLine[]; hiddenBefore: number }
export interface TextDiffModel { hunks: TextDiffHunk[]; additions: number; deletions: number; unchanged: boolean; limited: boolean; coarse: boolean; hiddenLines: number; totalLines: number }
const MAX_INPUT=1_000_000,MAX_ROWS=2500;

function logicalLines(text:string){
  const result:Array<{text:string;ending:TextDiffLine['ending']}>=[];
  for(const match of text.matchAll(/([^\n]*)(\n|$)/g)){
    if(!match[0])continue;
    const crlf=match[2]==='\n'&&match[1]!.endsWith('\r');
    result.push({text:crlf?match[1]!.slice(0,-1):match[1]!,ending:match[2]==='\n'?(crlf?'CRLF':'LF'):'无换行'});
  }
  return result;
}

/** Linear fallback for very long/dissimilar lines; boundaries never split a surrogate pair. */
function boundedInline(before:string,after:string):{before:DiffPart[];after:DiffPart[]}{
  let start=0,a=before.length,b=after.length;
  while(start<a&&start<b&&before.charCodeAt(start)===after.charCodeAt(start))start++;
  const high=(code:number)=>code>=0xd800&&code<=0xdbff,low=(code:number)=>code>=0xdc00&&code<=0xdfff;
  if(start>0&&high(before.charCodeAt(start-1)))start--;
  while(a>start&&b>start&&before.charCodeAt(a-1)===after.charCodeAt(b-1)){a--;b--;}
  if(a>0&&low(before.charCodeAt(a))&&high(before.charCodeAt(a-1))){a++;b++;}
  const parts=(text:string,end:number)=>[{text:text.slice(0,start),changed:false},{text:text.slice(start,end),changed:true},{text:text.slice(end),changed:false}].filter(part=>part.text.length);
  return {before:parts(before,a),after:parts(after,b)};
}
export function inlineTextDiff(before:string,after:string):{before:DiffPart[];after:DiffPart[]}{
  if(before===after)return {before:[{text:before,changed:false}],after:[{text:after,changed:false}]};
  const compare=/^[\x00-\x7f]*$/.test(before+after)?diffWordsWithSpace:diffChars;
  const changes=before.length+after.length<=8000?compare(before,after,{timeout:8,maxEditLength:500}):undefined;
  if(!changes)return boundedInline(before,after);
  return {before:changes.filter(part=>!part.added).map(part=>({text:part.value,changed:part.removed})),after:changes.filter(part=>!part.removed).map(part=>({text:part.value,changed:part.added}))};
}

export function diffDisplayText(text:string|undefined,path:string,pretty:boolean):{text:string;formatted:boolean}{
  if(text===undefined)return {text:'',formatted:false};
  // JavaScript parsing must not erase large IDs, exact decimals, exponent spelling or -0.
  const numbersRoundTrip=()=>Array.from(text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g)).every(([token])=>token.startsWith('"')||JSON.stringify(Number(token))===token);
  if(pretty&&/\.json$/i.test(path)&&text.length<MAX_INPUT&&numbersRoundTrip()){try{const value=JSON.parse(text);if(value!==null&&typeof value==='object')return {text:JSON.stringify(value,null,2)+'\n',formatted:true};}catch{/* Plain text remains exact. */}}
  return {text,formatted:false};
}

/** Exact line content + numbers, bounded work, and context hunks; no HTML is generated. */
export function buildTextDiff(before='',after='',context=3,expanded=false):TextDiffModel{
  const empty:TextDiffModel={hunks:[],additions:0,deletions:0,unchanged:before===after,limited:false,coarse:false,hiddenLines:0,totalLines:0};
  if(before===after)return empty;
  if(before.length+after.length>MAX_INPUT)return {...empty,unchanged:false,limited:true};
  let changes=diffLines(before,after,{timeout:80,maxEditLength:2000});
  const coarse=!changes;
  if(!changes)changes=[...(before?[{value:before,removed:true,added:false,count:0}]:[]),...(after?[{value:after,added:true,removed:false,count:0}]:[])] as ChangeObject<string>[];
  const rows:TextDiffLine[]=[];let oldLine=1,newLine=1,additions=0,deletions=0,inlineBudget=80_000;
  for(const change of changes){
    for(const line of logicalLines(change.value)){
      const kind=change.added?'added':change.removed?'removed':'context';
      if(kind==='added')additions++;else if(kind==='removed')deletions++;
      rows.push({...line,kind,...(kind!=='added'?{oldLine:oldLine++}:{}),...(kind!=='removed'?{newLine:newLine++}:{}),parts:[{text:line.text,changed:kind!=='context'}]});
    }
  }
  for(let i=0;i<rows.length;){
    if(rows[i]!.kind!=='removed'){i++;continue;}
    let endRemoved=i;while(rows[endRemoved]?.kind==='removed')endRemoved++;
    let endAdded=endRemoved;while(rows[endAdded]?.kind==='added')endAdded++;
    for(let k=0;k<Math.min(endRemoved-i,endAdded-endRemoved,40);k++){
      const old=rows[i+k]!,next=rows[endRemoved+k]!,size=old.text.length+next.text.length;
      const marked=inlineBudget>=size?inlineTextDiff(old.text,next.text):boundedInline(old.text,next.text);inlineBudget-=size;old.parts=marked.before;next.parts=marked.after;
    }
    i=endAdded;
  }
  const indices=rows.flatMap((row,index)=>row.kind==='context'?[]:[index]);
  const ranges:Array<[number,number]>=[];
  for(const index of indices){const start=expanded?0:Math.max(0,index-context),end=expanded?rows.length:Math.min(rows.length,index+context+1),last=ranges.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else ranges.push([start,end]);}
  let shown=0,previousEnd=0;const hunks:TextDiffHunk[]=[];
  for(const [start,end]of ranges){
    if(shown>=MAX_ROWS)break;
    const lines=rows.slice(start,Math.min(end,start+MAX_ROWS-shown));shown+=lines.length;
    const old=lines.filter(line=>line.oldLine!==undefined),next=lines.filter(line=>line.newLine!==undefined);
    const oldStart=old[0]?.oldLine??Math.max(0,(rows[start-1]?.oldLine??0)),newStart=next[0]?.newLine??Math.max(0,(rows[start-1]?.newLine??0));
    hunks.push({header:`@@ -${oldStart},${old.length} +${newStart},${next.length} @@`,lines,hiddenBefore:start-previousEnd});previousEnd=start+lines.length;
  }
  const wanted=ranges.reduce((sum,[a,b])=>sum+b-a,0);
  return {hunks,additions,deletions,unchanged:false,limited:wanted>MAX_ROWS,coarse,hiddenLines:Math.max(0,rows.length-shown),totalLines:rows.length};
}
