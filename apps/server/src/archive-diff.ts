import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ArchiveComparison, ArchiveMemberDiff } from '../../../packages/shared/src/releases.js';
import type { Provider,RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { safeFilePath,safeRef,safeSegment } from './safety.js';
import { compareZipBounds,readZipMembers,sha256,utf8Text,type ZipMember } from './zip-io.js';

export async function fixedReference(provider:Provider,key:RepoKey,ref:string){const branch=(await provider.branches(key)).find(item=>item.name===ref);return branch?.commitId??(provider.resolveRef?await provider.resolveRef(key,ref):(await provider.commit(key,ref)).id);}
function lineDiff(before:string,after:string){
  const a=before?before.split('\n'):[],b=after?after.split('\n'):[];if(a.length+b.length>10_000)return undefined;
  let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  let end=0;while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  const old=a.slice(start,a.length-end),next=b.slice(start,b.length-end),lines:Array<{type:'same'|'added'|'removed';text:string}>=a.slice(0,start).map(text=>({type:'same',text}));
  const coarse=old.length*next.length>1_000_000;
  if(coarse){for(const text of old)lines.push({type:'removed',text});for(const text of next)lines.push({type:'added',text});}
  else{const width=next.length+1,table=new Uint16Array((old.length+1)*width);for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--)table[i*width+j]=old[i]===next[j]?table[(i+1)*width+j+1]!+1:Math.max(table[(i+1)*width+j]!,table[i*width+j+1]!);let i=0,j=0;while(i<old.length&&j<next.length){if(old[i]===next[j]){lines.push({type:'same',text:old[i++]!});j++;}else if(table[(i+1)*width+j]!>=table[i*width+j+1]!)lines.push({type:'removed',text:old[i++]!});else lines.push({type:'added',text:next[j++]!});}while(i<old.length)lines.push({type:'removed',text:old[i++]!});while(j<next.length)lines.push({type:'added',text:next[j++]!});}
  for(const text of a.slice(a.length-end))lines.push({type:'same',text});return {lines,coarse};
}
export async function compareArchives(provider:Provider,key:RepoKey,input:{baseRef:string;headRef:string;basePath:string;headPath:string;entry?:string}):Promise<ArchiveComparison>{
  const [baseCommitId,headCommitId]=await Promise.all([fixedReference(provider,key,input.baseRef),fixedReference(provider,key,input.headRef)]);
  const raw=async(ref:string,path:string)=>{try{return (await provider.raw(key,ref,path)).content;}catch(error){if(error instanceof ApiError&&error.status===404)return undefined;throw error;}};
  const before=await raw(baseCommitId,input.basePath),after=await raw(headCommitId,input.headPath);
  if(!before&&!after)throw new ApiError(404,'ARCHIVE_NOT_FOUND','两个版本中都没有指定 ZIP。');
  const beforeMembers=before?await readZipMembers(before,compareZipBounds):[],afterMembers=after?await readZipMembers(after,compareZipBounds):[];
  const old=new Map(beforeMembers.map(item=>[item.name,item])),next=new Map(afterMembers.map(item=>[item.name,item]));
  const digest=(item:ZipMember)=>({size:item.content.length,sha256:item.sha256,mode:item.mode});
  const entries:ArchiveMemberDiff[]=[...new Set([...old.keys(),...next.keys()])].sort().map(path=>{const a=old.get(path),b=next.get(path);return {path,status:!a?'added':!b?'removed':a.sha256===b.sha256?'unchanged':'modified',...(a?{before:digest(a)}:{}),...(b?{after:digest(b)}:{}),...(a&&b&&a.mode!==b.mode?{metadataChanged:true}:{})};});
  const addedByHash=new Map<string,ArchiveMemberDiff[]>(),removedByHash=new Map<string,ArchiveMemberDiff[]>();for(const item of entries){if(item.path.endsWith('/'))continue;const map=item.status==='added'?addedByHash:item.status==='removed'?removedByHash:undefined,digest=item.status==='added'?item.after?.sha256:item.before?.sha256;if(map&&digest){const group=map.get(digest)??[];group.push(item);map.set(digest,group);}}for(const [digest,removed]of removedByHash){const added=addedByHash.get(digest);if(removed.length===1&&added?.length===1){removed[0]!.renameHint=added[0]!.path;added[0]!.renameHint=removed[0]!.path;}}
  const counts={added:0,removed:0,modified:0,unchanged:0};for(const entry of entries)counts[entry.status]++;
  const result:ArchiveComparison={baseCommitId,headCommitId,basePath:input.basePath,headPath:input.headPath,beforeSha256:before?sha256(before):'',afterSha256:after?sha256(after):'',identicalBytes:!!before&&!!after&&sha256(before)===sha256(after),contentEqual:!counts.added&&!counts.removed&&!counts.modified,complete:true,counts,entries};
  if(input.entry){const a=old.get(input.entry),b=next.get(input.entry);if(!a&&!b)throw new ApiError(404,'ARCHIVE_ENTRY_NOT_FOUND','没有此 ZIP 成员。');const aText=a?utf8Text(a.content):'',bText=b?utf8Text(b.content):'';
    if(a?.type==='directory'||b?.type==='directory')result.selected={path:input.entry,kind:'binary',reason:'目录只比较路径和元数据，不包含文本。'};
    else if(/\.zip$/i.test(input.entry)||aText===undefined||bText===undefined)result.selected={path:input.entry,kind:'binary',reason:'二进制、嵌套 ZIP 或超过 256 KiB 的条目仅比较 SHA-256 和大小。'};
    else{const diff=lineDiff(aText,bText);result.selected=diff?{path:input.entry,kind:'text',before:aText,after:bText,lines:diff.lines,...(diff.coarse?{reason:'变化区域超过精细对齐预算，以下以完整替换区展示；没有省略内容。'}:{})}:{path:input.entry,kind:'binary',reason:'文本差异超过 10000 行展示上限；成员 SHA-256 比较已完整完成。'};}
  }
  return result;
}
export function registerArchiveDiffRoutes(app:FastifyInstance,provider:Provider){let active=0;app.get('/api/repos/:namespace/:repo/archive-diff',async request=>{
  const key=z.object({namespace:z.string().transform(safeSegment),repo:z.string().transform(safeSegment)}).parse(request.params);
  const ref=z.string().min(1).max(160).transform(safeRef),path=z.string().min(1).max(1024).transform(safeFilePath);
  const input=z.object({baseRef:ref,headRef:ref,basePath:path,headPath:path,entry:z.string().min(1).max(1024).optional()}).strict().parse(request.query);
  if(!/\.zip$/i.test(input.basePath)||!/\.zip$/i.test(input.headPath))throw new ApiError(422,'ARCHIVE_EXTENSION','请选择 ZIP 附件。');
  if(active>=2)throw new ApiError(429,'ARCHIVE_BUSY','已有两个 ZIP 比较任务，请稍后重试。');active++;try{return await compareArchives(provider,key,input);}finally{active--;}
});}
