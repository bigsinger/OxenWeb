import type {DatasetAttachment,DatasetDescriptor,DatasetSnapshot} from '../../../packages/shared/src/dataset.js';
import {ApiError} from './errors.js';
import {safeFilePath} from './safety.js';

/** Release delivery policy, separate from annotation/review semantics and table visibility. */
export function datasetFieldExportPolicy(snapshot:DatasetSnapshot){
  return {version:1,excludedFields:Object.entries(snapshot.descriptor.fields??{}).filter(([,field])=>field.export===false).map(([id])=>id).sort()};
}
export interface ReleaseFieldProjection {
  filtered:boolean;excludedFields:string[];includedFields:string[];rows:Record<string,unknown>[];
  descriptor:DatasetDescriptor;attachments:DatasetAttachment[];allowsPointer:(pointer:string)=>boolean;
}
export function projectReleaseFields(snapshot:DatasetSnapshot,formal:boolean):ReleaseFieldProjection{
  const excludedFields=formal?datasetFieldExportPolicy(snapshot).excludedFields:[],excluded=new Set(excludedFields);
  const includedFields=[...new Set([...snapshot.rows.flatMap(row=>Object.keys(row)),...Object.keys(snapshot.descriptor.fields??{})])].filter(id=>!excluded.has(id));
  if(!excluded.size)return {filtered:false,excludedFields,includedFields,rows:snapshot.rows,descriptor:snapshot.descriptor,attachments:snapshot.attachments,allowsPointer:()=>true};
  const rows=snapshot.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([id])=>!excluded.has(id))));
  if(rows.length&&rows.every(row=>Object.keys(row).length===0))throw new ApiError(422,'RELEASE_FIELDS_EMPTY','全部实际样本字段均已取消导出；请至少选择一个有样本内容的字段，再构建 Release。');
  const descriptor:DatasetDescriptor={...snapshot.descriptor,identityField:excluded.has(snapshot.descriptor.identityField)?'':snapshot.descriptor.identityField,attachmentFields:snapshot.descriptor.attachmentFields.filter(id=>!excluded.has(id)),...(snapshot.descriptor.fields?{fields:Object.fromEntries(Object.entries(snapshot.descriptor.fields).filter(([id])=>!excluded.has(id)))}:{})};
  // These original-source pointers are not part of a projected, portable dataset package.
  delete descriptor.importManifestPath;delete descriptor.identityMapPath;
  const references=new Map<string,Set<string>>();
  rows.forEach((row,index)=>{for(const id of descriptor.attachmentFields){const raw=row[id];for(const value of Array.isArray(raw)?raw:[raw]){
    if(typeof value!=='string'||!value||/^[a-z][a-z0-9+.-]*:/i.test(value))continue;
    let filename:string;try{filename=safeFilePath(value);}catch{continue;}
    const ids=references.get(filename)??new Set<string>();ids.add(snapshot.rowIds[index]!);references.set(filename,ids);
  }}});
  const sourceFiles=new Set([snapshot.path,snapshot.descriptor.canonicalPath,snapshot.descriptor.importManifestPath,snapshot.descriptor.identityMapPath].filter((filename):filename is string=>!!filename));
  for(const filename of references.keys())if(sourceFiles.has(filename)||/^(?:\.oxenweb|\.oxen|provenance|source\/archives)\//i.test(filename))throw new ApiError(422,'RELEASE_EXPORT_SOURCE_ATTACHMENT','保留的附件字段指向完整源表、来源归档或控制文件，可能带回已排除字段。请取消该附件字段的导出或改为独立样本附件，再构建 Release。');
  const attachments=snapshot.attachments.flatMap(attachment=>{const ids=references.get(attachment.path);return ids?[{...attachment,rowIds:[...ids]}]:[];});
  const allowsPointer=(pointer:string)=>{
    if(!pointer.startsWith('/')||/\~(?:[^01]|$)/.test(pointer))return false;
    const top=pointer.slice(1).split('/')[0]!.replace(/~1/g,'/').replace(/~0/g,'~');
    return !excluded.has(top);
  };
  return {filtered:true,excludedFields,includedFields,rows,descriptor,attachments,allowsPointer};
}
