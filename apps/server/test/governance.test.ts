import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { DemoProvider } from '../src/demo.js';
import { loadConfig } from '../src/config.js';
import { validateGovernedAssignment } from '../src/governance.js';
import type { DimensionDraft, GovernanceDirectory, ProjectSchemaState, RepositoryRole, RepositoryTokenGrant } from '../../../packages/shared/src/index.js';

const base='/api/repos/oxen/visual-search',catalog='/api/governance/organizations/oxen',ownerToken='governance-test-instance-owner';
const bearer=(token=ownerToken)=>({authorization:`Bearer ${token}`});
async function setup(t:{after:(callback:()=>Promise<void>)=>void}){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'governance-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:ownerToken}),provider=new DemoProvider(config.demoFile),app=await createApp(config,provider);
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const call=async(method:'GET'|'POST'|'PUT'|'PATCH',url:string,payload?:unknown,token=ownerToken)=>{const result=await app.inject({method,url,headers:bearer(token),...(payload===undefined?{}:{payload})});return result;};
  const grant=async(role:RepositoryRole,capabilities?:string[])=>{const result=await call('POST',base+'/access',{name:'Test '+role,role,...(capabilities?{capabilities}:{})});assert.equal(result.statusCode,201,result.body);return result.json<RepositoryTokenGrant>();};
  const directoryState=async(token=ownerToken)=>(await call('GET',catalog,undefined,token)).json<GovernanceDirectory>();
  return {app,provider,config,call,grant,directoryState};
}

test('organization maintenance is independent of repository admin and cannot expose private datasets',async t=>{
  const {provider,call,grant,directoryState}=await setup(t),projectAdmin=await grant('admin'),maintainer=await grant('viewer'),editor=await grant('editor');
  for(const member of [projectAdmin,editor]){const access=await call('GET','/api/governance/access',undefined,member.token);assert.equal(access.json().canManage,false);assert.equal((await call('GET',catalog,undefined,member.token)).statusCode,403);}
  let org=(await directoryState()).organization;
  let result=await call('POST',catalog+'/maintainers',{identityId:maintainer.collaborator.id,enabled:true,expectedRevision:org.revision});assert.equal(result.statusCode,200,result.body);
  assert.equal((await call('GET','/api/governance/access',undefined,maintainer.token)).json().canManage,true);
  assert.equal((await call('GET',catalog,undefined,maintainer.token)).statusCode,200);
  assert.equal((await call('POST',catalog+'/maintainers',{identityId:editor.collaborator.id,enabled:true,expectedRevision:org.revision},maintainer.token)).statusCode,403);
  await provider.createRepo({namespace:'oxen',name:'private-other',description:'Private test',visibility:'private'});
  assert.equal((await call('GET','/api/repos/oxen/private-other',undefined,maintainer.token)).statusCode,403);
  const permissions=(await call('GET',base+'/settings',undefined,maintainer.token)).json().permissions;
  assert.equal(permissions.capabilities['schema.manage'],true);assert.equal(permissions.capabilities['data.edit'],false);assert.equal(permissions.capabilities['release.manage'],false);
  let head=(await call('GET',base+'/labels?ref=main')).json().commitId;
  result=await call('POST',base+'/labels/columns',{ref:'main',expectedCommit:head,column:{id:'only_schema',name:'Schema only',type:'text'}},maintainer.token);assert.equal(result.statusCode,200,result.body);head=result.json().commitId;
  result=await call('PUT',base+'/labels',{ref:'main',expectedCommit:head,columns:result.json().columns,assignments:[{scope:'dataset',values:{only_schema:'not authorized'}}]},maintainer.token);assert.equal(result.statusCode,403,result.body);assert.equal((await call('GET',base+'/labels?ref=main')).json().commitId,head);
  org=(await directoryState()).organization;
  result=await call('POST',catalog+'/maintainers',{identityId:maintainer.collaborator.id,enabled:false,expectedRevision:org.revision});assert.equal(result.statusCode,200,result.body);
  assert.equal((await call('GET',catalog,undefined,maintainer.token)).statusCode,403);
});

test('stable dimension and option identities publish immutable versions and templates pin their definitions',async t=>{
  const {call,directoryState,grant,config}=await setup(t),reader=await grant('viewer');
  const draft:DimensionDraft={id:'source',displayName:'来源',type:'single',description:'取得渠道',options:[{id:'public_dataset',displayName:'公开数据集',description:'可追溯的公开集合'},{id:'unknown',displayName:'未知'}]};
  let result=await call('POST',catalog+'/dimensions',{draft,expectedRevision:0});assert.equal(result.statusCode,200,result.body);let dimension=result.json();
  result=await call('POST',catalog+'/dimensions/source/publish',{expectedRevision:dimension.revision});assert.equal(result.statusCode,200,result.body);dimension=result.json();const v1=structuredClone(dimension.versions[0]);
  const template={id:'team_safety',name:'Team safety',domain:'general',description:'Local schema',bindings:[{dimensionId:'source',dimensionVersion:1,scopes:['dataset','row'],required:false,order:0}]};
  result=await call('POST',catalog+'/templates',{draft:template,expectedRevision:0});assert.equal(result.statusCode,200,result.body);
  result=await call('POST',catalog+'/templates/team_safety/publish',{expectedRevision:result.json().revision});assert.equal(result.statusCode,200,result.body);const templateV1=structuredClone(result.json().versions[0]);
  assert.equal((await call('GET',base+'/schema/templates',undefined,reader.token)).json().length,1);
  result=await call('GET',base+'/schema/templates/team_safety/1',undefined,reader.token);assert.equal(result.statusCode,200,result.body);assert.deepEqual(result.json(),templateV1);
  result=await call('POST',catalog+'/dimensions',{draft:{...draft,displayName:'新显示名',options:[{...draft.options[0],displayName:'公开来源'},draft.options[1]]},expectedRevision:dimension.revision});assert.equal(result.statusCode,200,result.body);
  result=await call('POST',catalog+'/dimensions/source/publish',{expectedRevision:result.json().revision});assert.equal(result.statusCode,200,result.body);dimension=result.json();assert.equal(dimension.versions.length,2);assert.deepEqual(dimension.versions[0],v1);
  assert.deepEqual((await call('GET',base+'/schema/templates/team_safety/1',undefined,reader.token)).json(),templateV1);
  result=await call('POST',catalog+'/dimensions',{draft:{...dimension.draft,options:[dimension.draft.options[0]]},expectedRevision:dimension.revision});assert.equal(result.statusCode,409,result.body);
  result=await call('POST',catalog+'/dimensions',{draft:{...dimension.draft,options:dimension.draft.options.map((option:object)=>({...option,deprecated:true}))},expectedRevision:dimension.revision});assert.equal(result.statusCode,200,result.body);
  assert.equal((await directoryState()).organization.dimensions[0]?.versions[0]?.checksum,v1.checksum);
  const deprecatedSnapshot=structuredClone(templateV1);deprecatedSnapshot.dimensions[0].options[0].deprecated=true;
  assert.throws(()=>validateGovernedAssignment(deprecatedSnapshot,'row',{source:'public_dataset'}),/已弃用/);
  validateGovernedAssignment(deprecatedSnapshot,'row',{source:'public_dataset'},{source:'public_dataset'});
  const restarted=await createApp(config);t.after(()=>restarted.close());
  const persisted=await restarted.inject({url:base+'/schema/templates/team_safety/1',headers:bearer(reader.token)});assert.equal(persisted.statusCode,200,persisted.body);assert.deepEqual(persisted.json(),templateV1);
});

test('preset copy preserves legacy Chinese values, binding writes one snapshot commit and ordinary users only consume publications',async t=>{
  const {call,grant,provider,directoryState}=await setup(t),lead=await grant('lead'),annotator=await grant('annotator');
  let result=await call('POST',catalog+'/templates/from-preset',{presetId:'prompt-injection',id:'org_prompt',name:'组织提示词注入'});assert.equal(result.statusCode,200,result.body);let template=result.json();
  assert.equal((await call('GET',base+'/schema/templates',undefined,annotator.token)).json().length,0);
  result=await call('POST',catalog+'/templates/org_prompt/publish',{expectedRevision:template.revision});assert.equal(result.statusCode,200,result.body);template=result.json();const snapshot=template.versions[0];
  assert.ok(snapshot.columns.find((column:{id:string})=>column.id==='data_source').options.some((option:{value:string})=>option.value==='用户提交'));
  const key={namespace:'oxen',repo:'visual-search'},head=(await provider.branches(key)).find(item=>item.name==='main')!.commitId;
  const body={ref:'main',expectedCommit:head,organizationId:'oxen',templateId:'org_prompt',templateVersion:1};
  assert.equal((await call('POST',base+'/schema/binding',body,annotator.token)).statusCode,403);
  result=await call('POST',base+'/schema/binding',body,lead.token);assert.equal(result.statusCode,200,result.body);const bound=result.json<ProjectSchemaState>();assert.notEqual(bound.commitId,head);
  assert.deepEqual((await provider.commit(key,bound.commitId)).files.map(file=>file.path),['.oxenweb/schema-binding.json']);
  result=await call('GET',base+'/schema?ref='+bound.commitId,undefined,annotator.token);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().binding.checksum,snapshot.checksum);
  assert.equal((await call('POST',base+'/schema/binding',body,lead.token)).statusCode,409);
  assert.equal((await call('POST',catalog+'/templates/from-preset',{presetId:'general',id:'not_allowed',name:'No'},annotator.token)).statusCode,403);
  result=await call('POST',base+'/schema/feedback',{dimensionId:'data_source',requestedOption:'另一个渠道',reason:'本任务需要补充来源选项'},annotator.token);assert.equal(result.statusCode,200,result.body);
  const feedback=(await directoryState()).feedback[0]!;assert.equal(feedback.authorId,annotator.collaborator.id);assert.equal(feedback.status,'open');
  result=await call('POST',catalog+'/feedback/'+feedback.id+'/respond',{status:'resolved',response:'将通过新规范版本补充'});assert.equal(result.statusCode,200,result.body);
});

test('legacy schema endpoints and generic files cannot bypass governed dimensions or managed sample edits',async t=>{
  const {call,grant,provider}=await setup(t),editor=await grant('editor'),admin=await grant('admin'),reviewer=await grant('reviewer'),custom=await grant('editor',['data.edit']);
  const key={namespace:'oxen',repo:'visual-search'},head=(await provider.branches(key)).find(item=>item.name==='main')!.commitId;
  for(const member of [editor,admin,reviewer]){
    for(const [method,url,payload] of [
      ['POST',base+'/labels/columns',{ref:'main',expectedCommit:head,column:{id:'evil',name:'Unauthorized',type:'text'}}],
      ['PUT',base+'/labels',{ref:'main',expectedCommit:head,columns:[],assignments:[]}],
      ['POST',base+'/labels/templates/apply',{ref:'main',expectedCommit:head,templateId:'general',templateVersion:1}],
    ] as const)assert.equal((await call(method,url,payload,member.token)).statusCode,403);
  }
  assert.equal((await call('POST',base+'/labels/assignments',{ref:'main',expectedCommit:head,scope:'dataset',values:{}},custom.token)).statusCode,403);
  const workspace=(await provider.createWorkspace(key,'Test draft','main')).id;
  for(const token of [ownerToken,editor.token])for(const filename of ['.oxenweb/labels.json','.oxenweb/schema-binding.json','data/samples.jsonl','source/original.jsonl','packages/sample.zip']){
    const result=await call('PUT',base+'/workspaces/'+workspace+'/files',{path:filename,content:'{}'},token);assert.equal(result.statusCode,403,result.body);
  }
  assert.equal((await call('POST',base+'/table/edit',{ref:'main',expectedCommit:head,path:'data/samples.jsonl',operations:[],message:'Bypass'},ownerToken)).statusCode,403);
  let result=await call('PUT',base+'/workspaces/'+workspace+'/files',{path:'notes.txt',content:'Unmanaged human note'},editor.token);assert.equal(result.statusCode,200,result.body);
  result=await call('POST',base+'/push',{branch:'main'},editor.token);assert.equal(result.statusCode,403,result.body);
  assert.equal((await provider.branches(key)).find(item=>item.name==='main')?.commitId,head);
});
