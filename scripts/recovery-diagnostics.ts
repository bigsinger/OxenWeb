import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

/** Deliberately excludes error.message, assertion values, arbitrary stack text and function names. */
export async function recoveryFailureDiagnostic(error:unknown,phase:string,workspace:string){
 const item=(error&&typeof error==='object'?error:{}) as {name?:unknown;code?:unknown;status?:unknown;stack?:unknown;check?:unknown};
 const names=new Set(['Error','AssertionError','TypeError','RangeError','SyntaxError','ApiError','RecoveryControlCheckError']);
 const result:{phase:string;name:string;code?:string;status?:number;frames:string[]}={phase:/^[a-z][a-z0-9-]{0,79}$/.test(phase)?phase:'unknown',name:typeof item.name==='string'&&names.has(item.name)?item.name:'Error',frames:[]};
 if(typeof item.code==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(item.code))result.code=item.code;
 if(!result.code&&typeof item.check==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(item.check))result.code='RECOVERY_CONTROL_'+item.check;
 if(Number.isInteger(item.status)&&Number(item.status)>=100&&Number(item.status)<=599)result.status=Number(item.status);
 const root=await realpath(workspace);
 for(const line of (typeof item.stack==='string'?item.stack:'').split('\n')){
  if(!/^\s+at /.test(line)||result.frames.length>=6)continue;
  let location=line.trim().slice(3).replace(/^async /,'');if(location.endsWith(')'))location=location.slice(location.lastIndexOf('(')+1,-1);
  const match=/^(.*):(\d{1,8}):(\d{1,8})$/.exec(location);if(!match)continue;
  const target=match[1]!;
  if(/^node:(?:internal\/(?:process\/task_queues|async_local_storage\/async_hooks|modules\/esm\/(?:module_job|loader))|async_hooks)$/.test(target)){result.frames.push('at '+target+':'+match[2]+':'+match[3]);continue;}
  try{
   const filename=target.startsWith('file:')?fileURLToPath(target):target;if(!path.isAbsolute(filename))continue;
   const resolved=await realpath(filename),relative=path.relative(root,resolved).replaceAll('\\','/');
   if(!/^(?:scripts\/|apps\/server\/(?:src|dist)\/|packages\/|node_modules\/)/.test(relative)||! /\.(?:[cm]?[jt]s)$/.test(relative)||(await lstat(filename)).isSymbolicLink())continue;
   result.frames.push('at '+relative+':'+match[2]+':'+match[3]);
  }catch{/* A forged or nonexistent stack location is not diagnostic evidence. */}
 }
 return result;
}
