import { z } from 'zod';
import type { LabelDocument } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { ApiError } from './errors.js';
import { inferColumns, parseJsonl, stableRowIds } from './jsonl.js';
import { assignmentId, LABEL_PATH, validateLabelDocument } from './labels.js';

const column=z.string().trim().min(1).max(200).refine(name=>!['__proto__','constructor','prototype'].includes(name),'保留字段名不可编辑。');
const record=z.record(z.string(),z.unknown());
export const tableOperation=z.discriminatedUnion('op',[
  z.object({op:z.literal('update'),rowId:z.string().min(1),record}).strict(),
  z.object({op:z.literal('delete'),rowId:z.string().min(1)}).strict(),
  z.object({op:z.literal('append'),record}).strict(),
  z.object({op:z.literal('add-column'),name:column,value:z.unknown()}).strict(),
  z.object({op:z.literal('rename-column'),from:column,to:column}).strict(),
  z.object({op:z.literal('remove-column'),name:column}).strict(),
]);
export type TableOperation=z.infer<typeof tableOperation>;
export function applyTableOperations(original:Record<string,unknown>[],operations:TableOperation[]){
  const ids=stableRowIds(original);
  let items=original.map((row,index)=>({original:ids[index]!,row:structuredClone(row)}));
  for(const operation of operations){
    if(operation.op==='append'){items.push({original:'',row:structuredClone(operation.record)});continue;}
    if(operation.op==='update'||operation.op==='delete'){
      const index=items.findIndex(item=>item.original===operation.rowId);
      if(index<0)throw new ApiError(409,'TABLE_ROW_CHANGED','目标行已被删除或当前版本不匹配，请重新加载。');
      if(operation.op==='delete')items.splice(index,1);else items[index]!.row=structuredClone(operation.record);
      continue;
    }
    const names=new Set(items.flatMap(item=>Object.keys(item.row)));
    if(operation.op==='add-column'){
      if(names.has(operation.name))throw new ApiError(422,'TABLE_COLUMN_EXISTS','该数据列已存在。');
      items=items.map(item=>({...item,row:{...item.row,[operation.name]:structuredClone(operation.value)}}));
    }else if(operation.op==='rename-column'){
      if(!names.has(operation.from)||names.has(operation.to))throw new ApiError(422,'TABLE_COLUMN_INVALID','原列不存在或目标列已经存在。');
      items=items.map(item=>({...item,row:Object.fromEntries(Object.entries(item.row).map(([key,value])=>[key===operation.from?operation.to:key,value]))}));
    }else{
      if(!names.has(operation.name))throw new ApiError(422,'TABLE_COLUMN_INVALID','要删除的数据列不存在。');
      items=items.map(item=>({...item,row:Object.fromEntries(Object.entries(item.row).filter(([name])=>name!==operation.name))}));
    }
  }
  if(!items.length)throw new ApiError(422,'TABLE_EMPTY','不能将 JSONL 数据集保存为空文件。');
  const rows=items.map(item=>item.row),nextIds=stableRowIds(rows);
  const mapping=new Map(items.flatMap((item,index)=>item.original?[[item.original,nextIds[index]!] as const]:[]));
  return {rows,mapping};
}
export function moveRowLabels(document:LabelDocument,filename:string,mapping:Map<string,string>):LabelDocument{
  return validateLabelDocument({...document,assignments:document.assignments.flatMap(assignment=>{
    if(assignment.scope!=='row'||assignment.path!==filename)return [assignment];
    const rowId=mapping.get(assignment.rowId!);if(!rowId)return [];
    const next={...assignment,rowId};return [{...next,id:assignmentId(next)}];
  })});
}
export class TableEditorService{
  private chains=new Map<string,Promise<void>>();
  constructor(private provider:Provider){}
  async save(key:RepoKey,branch:string,expected:string,filename:string,operations:TableOperation[],message:string){
    if(!/\.(jsonl|ndjson)$/i.test(filename))throw new ApiError(415,'TABLE_EDIT_FORMAT','当前结构化编辑支持 JSONL/NDJSON；其他格式可在 workspace 上传替换。');
    const name=`${key.namespace}/${key.repo}`,previous=this.chains.get(name)??Promise.resolve();
    const current=previous.then(async()=>{
      const check=async()=>{if((await this.provider.branches(key)).find(item=>item.name===branch)?.commitId!==expected)throw new ApiError(409,'TABLE_VERSION_CONFLICT','分支版本已更新，请重新加载编辑内容。');};
      await check();
      const content=await this.provider.raw(key,expected,filename),parsed=parseJsonl(content.content);
      const edited=applyTableOperations(parsed.rows,operations);
      let labels:LabelDocument|undefined;
      try{const raw=await this.provider.raw(key,expected,LABEL_PATH);labels=moveRowLabels(validateLabelDocument(JSON.parse(raw.content.toString('utf8'))),filename,edited.mapping);}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}
      const bytes=Buffer.from(edited.rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
      if(bytes.length>10*1024*1024)throw new ApiError(413,'TABLE_EDIT_LIMIT','编辑结果超过 10 MB。');
      const workspace=await this.provider.createWorkspace(key,'Oxen Web table editor',branch);let committed=false;
      try{
        if(workspace.baseCommitId&&workspace.baseCommitId!==expected)throw new ApiError(409,'TABLE_VERSION_CONFLICT','编辑工作区基准已变化。');
        await this.provider.writeWorkspace(key,workspace.id,filename,bytes);
        if(labels)await this.provider.writeWorkspace(key,workspace.id,LABEL_PATH,Buffer.from(JSON.stringify(labels,null,2)+'\n'));
        await check();const commit=await this.provider.commitWorkspace(key,workspace.id,message,expected);committed=true;
        return {commitId:commit.id,ref:branch,path:filename,rowCount:edited.rows.length,columns:inferColumns(edited.rows)};
      }finally{if(committed)await this.provider.deleteWorkspace(key,workspace.id).catch(()=>{});}
    });
    const settled=current.then(()=>{},()=>{});this.chains.set(name,settled);void settled.then(()=>{if(this.chains.get(name)===settled)this.chains.delete(name);});return current;
  }
}
