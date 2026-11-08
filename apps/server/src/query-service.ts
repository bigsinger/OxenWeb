import type { FilePreview } from '../../../packages/shared/src/index.js';
import type { Provider, RepoKey } from './provider.js';
import { tableFrom } from './preview.js';
import { ApiError } from './errors.js';
import { modelQuery } from './query-planner.js';
import { naturalQuery } from './natural-query.js';

/** Resolve the branch once so later pages cannot mix revisions. */
export async function loadQueryTable(provider:Provider,key:RepoKey,reference:string,filename:string):Promise<FilePreview>{
  const branches=await provider.branches(key);const commit=branches.find(branch=>branch.name===reference)?.commitId??reference;
  if(/\.(csv|tsv|jsonl|ndjson)$/i.test(filename)){
    const raw=await provider.raw(key,commit,filename);const table=tableFrom(raw.content.toString('utf8'),filename);
    if(!table)throw new ApiError(400,'TABLE_REQUIRED','请选择表格文件。');
    if(table.rows.length>250000)throw new ApiError(413,'QUERY_TABLE_LIMIT','当前本地查询最多扫描 250000 行，请缩小数据集。不会用样本行冒充完整结果。');
    return {kind:'table',path:filename,mime:raw.mime,size:raw.content.length,...table,totalRows:table.rows.length};
  }
  const first=await provider.file(key,commit,filename,1,500);
  if(first.kind!=='table')throw new ApiError(400,'TABLE_REQUIRED','请选择表格文件。');
  const total=first.totalRows??first.rows?.length??0;
  if(total>250000)throw new ApiError(413,'QUERY_TABLE_LIMIT','当前本地查询最多扫描 250000 行，请缩小数据集。不会用样本行冒充完整结果。');
  const rows=[...(first.rows??[])];
  for(let page=2;rows.length<total;page++){
    const next=await provider.file(key,commit,filename,page,500);
    if(!next.rows?.length)throw new ApiError(502,'QUERY_INCOMPLETE','上游分页提前结束，未执行不完整数据查询。');
    rows.push(...next.rows);
  }
  return {...first,rows,totalRows:total};
}
export async function queryDataset(provider:Provider,key:RepoKey,reference:string,filename:string,prompt:string,engine:'model'|'rules',allowExternalSchema=false){
  if(engine==='model'&&!allowExternalSchema)throw new ApiError(403,'QUERY_SCHEMA_CONSENT_REQUIRED','模型查询需要明确允许将字段名、类型和问题发送至 OpenAI；记录正文不会发送。可选择完全本地的规则查询。');
  const table=await loadQueryTable(provider,key,reference,filename);
  if(engine==='model')return modelQuery(table,prompt);
  const result=naturalQuery(table,prompt);return {...result,scannedRows:table.rows?.length??0,sourceRows:table.totalRows??0};
}
