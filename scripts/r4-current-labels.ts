/** Development cleanup authorized by the user: current schema only; never edit sample bodies. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import createClient from 'openapi-fetch';
import type { paths } from '../packages/contracts/src/oxen.js';
import type { DatasetLabelRecord } from '../packages/shared/src/dataset.js';
import type { ProjectSchemaBindingV2 } from '../packages/shared/src/governance-types.js';
import { LiveProvider } from '../apps/server/src/live.js';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { datasetFiles, datasetHash, optionalRaw } from '../apps/server/src/dataset-storage.js';
import { recordUsesActiveLayer } from '../apps/server/src/dataset-layer-compat.js';
import { sha256 } from '../apps/server/src/zip-io.js';

for(const filename of ['.env','infra/oxen/local.env']){try{process.loadEnvFile(path.join(projectRoot,filename));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
const config=loadConfig();assert.equal(config.demo,false);assert.equal(config.upstream,'http://127.0.0.1:3002');
const folder=path.join(projectRoot,'.data/r4-current-labels');await mkdir(folder,{recursive:true});
const provider=new LiveProvider({...config,demoFile:path.join(folder,'state.json')});await provider.init();
const api=createClient<paths>({baseUrl:config.upstream,headers:config.upstreamToken?{Authorization:'Bearer '+config.upstreamToken}:{}});
const names=['benchmark-sensitive-data','benchmark-prompt-injection','benchmark-behavior-drift','benchmark-skills'],results=[];
for(const repo of names){
 const key={namespace:'local',repo},branches=await provider.branches(key);assert.deepEqual(branches.map(item=>item.name),['main'],'Review other branches explicitly before development reset');
 const before=branches[0]!.commitId,base='/api/repos/local/'+repo;
 const response=await fetch('http://127.0.0.1:3001'+base+'/settings');assert.ok(response.ok);const settings=await response.json() as any;assert.equal(settings.commitId,before);
 const source=await provider.raw(key,before,'data/samples.jsonl'),sourceHash=sha256(source.content),binding=JSON.parse((await provider.raw(key,before,'.oxenweb/schema-binding.json')).content.toString()) as ProjectSchemaBindingV2;
 assert.equal(binding.version,2);assert.ok(binding.layers.dataset&&binding.layers.sample);
 const retired:string[]=[];
 for(const filename of await datasetFiles(provider,key,before,'.oxenweb/dataset/labels')){const record=JSON.parse((await provider.raw(key,before,filename)).content.toString()) as DatasetLabelRecord;if(!recordUsesActiveLayer(record,binding))retired.push(filename);}
 for(const filename of await datasetFiles(provider,key,before,'.oxenweb/dataset/legacy-labels'))retired.push(filename);
 const authority='.oxenweb/dataset/dataset-labels.json',rawAuthority=await optionalRaw(provider,key,before,authority);if(rawAuthority&&!recordUsesActiveLayer(JSON.parse(rawAuthority.content.toString()),binding))retired.push(authority);
 const cleanBinding={...binding};delete cleanBinding.legacy;delete cleanBinding.legacyColumns;cleanBinding.checksum=datasetHash({version:2,layers:cleanBinding.layers});
 const policy={...settings.policy,tags:[...new Set(settings.policy.tags.map((tag:string)=>/^ai[-_ ]safety$/i.test(tag)?'aisec':tag))],updatedAt:new Date().toISOString(),updatedBy:'owner'};
 const oldLabels=JSON.parse((await provider.raw(key,before,'.oxenweb/labels.json')).content.toString()),retiredAssignments=oldLabels.assignments?.length??0;
 const workspace=await provider.createWorkspace(key,'Current labels and aisec metadata','main');assert.equal(workspace.baseCommitId,before);
 await provider.writeWorkspace(key,workspace.id,'.oxenweb/schema-binding.json',Buffer.from(JSON.stringify(cleanBinding,null,2)+'\n'));
 await provider.writeWorkspace(key,workspace.id,'.oxenweb/labels.json',Buffer.from(JSON.stringify({version:1,columns:[],assignments:[]})+'\n'));
 await provider.writeWorkspace(key,workspace.id,'.oxenweb/repository.json',Buffer.from(JSON.stringify(policy,null,2)+'\n'));
 if(retired.length){const removed=await api.DELETE('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files',{params:{path:{namespace:'local',repo_name:repo,workspace_id:workspace.id}},body:retired});assert.equal(removed.response.status,200,'A partial removal is not a completed cleanup');}
 const committed=await provider.commitWorkspace(key,workspace.id,'Use current dataset/sample labels and rename project tag to aisec',before);await provider.deleteWorkspace(key,workspace.id);
 assert.equal(sha256((await provider.raw(key,committed.id,'data/samples.jsonl')).content),sourceHash);
 const detail=await provider.commit(key,committed.id);assert.ok(detail.files.every(file=>file.path.startsWith('.oxenweb/')),'Only Web metadata is changed');
 for(const filename of retired)assert.equal(await optionalRaw(provider,key,committed.id,filename),undefined);
 results.push({repo,before,commitId:committed.id,retiredAssignments,removedRetiredRecords:retired.length,sourceUnchanged:true,tags:policy.tags});
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(path.join(folder,'verification.json'),JSON.stringify({version:1,checkedAt:new Date().toISOString(),results},null,2));
