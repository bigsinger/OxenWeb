/** Local analysis only: immutable repository GETs, never a BFF app or a CLI clone. */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,projectRoot} from '../../apps/server/src/config.js';
import {LiveProvider} from '../../apps/server/src/live.js';
import type {Provider,RepoKey} from '../../apps/server/src/provider.js';
import {DatasetService} from '../../apps/server/src/dataset.js';
import {GovernanceService} from '../../apps/server/src/governance.js';
import type {RepositoryAccessService} from '../../apps/server/src/repository-access.js';
import {WorkflowService} from '../../apps/server/src/workflow.js';
import {canonicalJson} from '../../apps/server/src/dataset-storage.js';
import type {DatasetSnapshot} from '../../packages/shared/src/dataset.js';

export type DatasetKind='sensitive'|'injection'|'skills'|'drift';
export const targets:Array<{repo:string;kind:DatasetKind;alias?:boolean}>=[{repo:'benchmark-sensitive-data',kind:'sensitive'},{repo:'benchmark-prompt-injection',kind:'injection'},{repo:'benchmark-skills',kind:'skills'},{repo:'benchmark-behavior-drift',kind:'drift'},{repo:'prompt-injection-bench',kind:'injection',alias:true}];
export const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export async function optionalFile(filename:string){try{return await readFile(filename);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
export async function privateJson(directory:string,name:string,value:unknown){assert.equal(path.dirname(path.resolve(directory,name)),path.resolve(directory));await writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
export interface PinnedProject {repo:string;kind:DatasetKind;alias?:boolean;commit:string;canonicalPath:string;canonicalSha256:string;effectiveSha256:string;rows:number;branches:Array<{name:string;commitId:string}>}
export interface AnalysisPins {version:1;createdAt:string;ownerDeclaration:string;projects:PinnedProject[];control:Record<string,{sha256:string|null}>}

export async function analysisDirectory(provided?:string){
 const parent=path.join(projectRoot,'.data/r14-split-analysis'),directory=path.resolve(provided??path.join(parent,'run-'+new Date().toISOString().replace(/[:.]/g,'-')));const relative=path.relative(parent,directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await mkdir(directory,{recursive:true,mode:0o700});
 for(const name of ['fingerprint.key','allocation.key'])if(!await optionalFile(path.join(directory,name)))await writeFile(path.join(directory,name),randomBytes(32),{flag:'wx',mode:0o600});
 await writeFile(path.join(parent,'run-directory.txt'),directory+'\n');return directory;
}
export async function captureReadOnlyInputs(directory:string){
 for(const name of ['.env','infra/oxen/local.env'])try{process.loadEnvFile(path.join(projectRoot,name));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const config=loadConfig(),url=new URL(config.upstream!);assert.equal(config.demo,false);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.equal(url.port,'3002');
 const originalFetch=globalThis.fetch,requestCounts={GET:0,rejectedMethods:0,rejectedOrigins:0};
 globalThis.fetch=async(input,init)=>{const requestUrl=new URL(typeof input==='string'||input instanceof URL?String(input):input.url),method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();if(requestUrl.origin!==url.origin){requestCounts.rejectedOrigins++;throw Error('READONLY_ORIGIN_DENIED');}if(method!=='GET'){requestCounts.rejectedMethods++;throw Error('READONLY_METHOD_DENIED');}requestCounts.GET++;return originalFetch(input,{...init,redirect:'error'});};
 const live=new LiveProvider(config);await live.init();
 const readMethods=new Set(['branches','resolveRef','raw','tree','commits','commit','legacyAnnotations','annotations','checkReady']);
 const provider=new Proxy(live,{get(target,property){const value=Reflect.get(target,property);if(typeof value!=='function')return value;if(!readMethods.has(String(property)))return()=>{throw Error('READONLY_PROVIDER_MUTATION_DENIED');};return value.bind(target);}}) as Provider;
 const deniedAccess=new Proxy({},{get(){return()=>{throw Error('READONLY_ACCESS_SERVICE_DENIED');};}}) as RepositoryAccessService;
 const governance=new GovernanceService(provider,deniedAccess,path.join(directory,'unused-governance.json'));
 const controlRoot=path.dirname(config.demoFile),controlNames=['evaluation-policy.json','annotation-tasks.json','releases/records.json'];
 const controlBytes=new Map(await Promise.all(controlNames.map(async name=>[name,await optionalFile(path.join(controlRoot,name))] as const)));
 const policy=JSON.parse(controlBytes.get('evaluation-policy.json')?.toString('utf8')??'{"version":1,"projects":{}}');
 const datasets=new DatasetService(provider,{governance:{snapshot:(key,ref)=>governance.snapshot(key,ref)},evaluation:{enabled:async key=>!!policy.projects?.[key.namespace+'/'+key.repo]?.enabled}});
 const workflow=new WorkflowService({provider,datasets,access:deniedAccess,filename:path.join(controlRoot,'annotation-tasks.json')});await workflow.init();
 const existing=await optionalFile(path.join(directory,'pins.json')),pins:AnalysisPins=existing?JSON.parse(existing.toString('utf8')):{version:1,createdAt:new Date().toISOString(),ownerDeclaration:'Owner confirmed all four datasets were never distributed externally or used for training/tuning (2026-11-09).',projects:[],control:{}};
 if(!existing)for(const [name,bytes]of controlBytes)pins.control[name]={sha256:bytes?digest(bytes):null};
 if(existing)for(const [name,bytes]of controlBytes)assert.equal(bytes?digest(bytes):null,pins.control[name]?.sha256,'Control cutoff changed; create a new analysis run rather than mixing evidence.');
 for(const [name,bytes]of controlBytes){const latest=await optionalFile(path.join(controlRoot,name));assert.equal(latest?digest(latest):null,bytes?digest(bytes):null,'Control plane changed while loading read-only services.');}
 const captured:Array<{pin:PinnedProject;snapshot:DatasetSnapshot}>=[];
 try{
  for(const target of targets){const key={namespace:'local',repo:target.repo};let branches;try{branches=await provider.branches(key);}catch(e){if(target.alias&&(e as {status?:number}).status===404)continue;throw e;}const main=branches.find(b=>b.name==='main');if(!main){if(target.alias)continue;throw Error('MISSING_MAIN_BRANCH');}const prior=pins.projects.find(p=>p.repo===target.repo),commit=prior?.commit??main.commitId;
   const snapshot=await datasets.read(key,commit),source=await provider.raw(key,commit,snapshot.path),effectiveSha256=digest(canonicalJson(snapshot.rowIds.map((id,index)=>({id,record:snapshot.rows[index]}))));
   const pin:PinnedProject={...target,commit,canonicalPath:snapshot.path,canonicalSha256:digest(source.content),effectiveSha256,rows:snapshot.totalRows,branches:branches.map(({name,commitId})=>({name,commitId}))};
   if(prior){assert.equal(pin.canonicalSha256,prior.canonicalSha256);assert.equal(pin.effectiveSha256,prior.effectiveSha256);assert.equal(pin.rows,prior.rows);}else pins.projects.push(pin);captured.push({pin,snapshot});
  }
  if(!existing)await privateJson(directory,'pins.json',pins);
 }catch(error){globalThis.fetch=originalFetch;throw error;}
 const releases=JSON.parse(controlBytes.get('releases/records.json')?.toString('utf8')??'{"version":1,"releases":[],"shares":[]}');
 return{pins,captured,provider,datasets,workflow,releases,controlBytes,config,requestCounts,
  resolveZip:async(repo:string,commit:string,filename:string)=>(await provider.raw({namespace:'local',repo},commit,filename)).content,
  async finish(){const checks=[];for(const {pin}of captured){const key={namespace:'local',repo:pin.repo},head=(await provider.branches(key)).find(b=>b.name==='main')?.commitId,source=await provider.raw(key,pin.commit,pin.canonicalPath);checks.push({repo:pin.repo,pinnedCommit:pin.commit,headAfter:head,headUnchanged:head===pin.commit,canonicalBytesUnchanged:digest(source.content)===pin.canonicalSha256});}const controls=[];for(const [name,before]of controlBytes){const after=await optionalFile(path.join(controlRoot,name));controls.push({name,unchanged:(before?digest(before):null)===(after?digest(after):null),sha256:after?digest(after):null});}globalThis.fetch=originalFetch;const verification={completedAt:new Date().toISOString(),requests:requestCounts,inputChecks:checks,controlChecks:controls,oxenWrites:0,cliCalls:0,rawRecordBodiesSentExternally:false};await privateJson(directory,'read-only-verification.json',verification);assert.ok(checks.every(c=>c.canonicalBytesUnchanged));return verification;},
  releaseFetchGuard(){globalThis.fetch=originalFetch;}
 };
}

export function recordSchema(rows:Record<string,unknown>[]){const fields:Record<string,Record<string,number>>=Object.create(null);function walk(value:unknown,prefix:string,depth:number){const type=value===null?'null':Array.isArray(value)?'array':typeof value;(fields[prefix]??=Object.create(null))[type]=((fields[prefix]??{})[type]??0)+1;if(depth>=3)return;if(Array.isArray(value)){for(const child of value.slice(0,3))if(child&&typeof child==='object')walk(child,prefix+'[]',depth+1);}else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(key.length<=160)walk(child,prefix?prefix+'.'+key:key,depth+1);}}for(const row of rows)for(const [key,value]of Object.entries(row))if(key!=='__bundle_provenance')walk(value,key,0);return fields;}
