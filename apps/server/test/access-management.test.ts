import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import {DemoProvider} from '../src/demo.js';
import {RepositorySettingsService} from '../src/repository-settings.js';
import {RepositoryAccessService,installRepositoryAccess,registerRepositoryControl} from '../src/repository-access.js';
import {installAuth} from '../src/auth.js';
import {loadConfig} from '../src/config.js';
import {GlobalAuditService,auditQuerySchema} from '../src/global-audit.js';
import {registerAccessManagementRoutes} from '../src/access-management-routes.js';
import {createApp} from '../src/app.js';
import {DatasetService} from '../src/dataset.js';
import {createColdBackup,restoreBackup} from '../src/backup.js';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
const token='r10-synthetic-owner-access-management',owner:RequestIdentity={id:'owner',name:'Synthetic owner',kind:'owner',source:'bearer'},key={namespace:'oxen',repo:'visual-search'},base='/api/repos/oxen/visual-search';
async function fixture(t:{after:(action:()=>Promise<void>)=>void},localOwner=false){
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'r10-access-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'demo.json'),...(!localOwner?{BFF_TOKEN:token}:{})}),provider=new DemoProvider(config.demoFile);await provider.init();
  const settings=new RepositorySettingsService(provider),access=new RepositoryAccessService(settings,path.join(directory,'access-credentials.json'),localOwner);await access.init();const audit=new GlobalAuditService(path.join(directory,'global-audit.json'));await audit.init();access.setAuditRecorder(audit);
  const app=Fastify();app.setErrorHandler((error:any,_request,reply)=>reply.code(error.status??(error.name==='ZodError'?400:500)).send({error:{code:error.code??'INPUT_INVALID',message:error.message}}));const auth=installAuth(app,config);installRepositoryAccess(app,access,auth);registerRepositoryControl(app,{settings,access});registerAccessManagementRoutes(app,{access,audit});
  t.after(async()=>{await app.close();if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true});});
  const call=(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,payload?:unknown,credential=token)=>app.inject({method,url,headers:{authorization:'Bearer '+credential},...(payload===undefined?{}:{payload})});
  return {app,config,directory,provider,settings,access,audit,call};
}

test('issued project credentials show issuer, expiry and scope but never raw tokens or stored hashes',async t=>{
  const f=await fixture(t),grant=await f.call('POST','/api/access-management/grants',{scope:'project',repository:key,name:'Synthetic worker',role:'annotator'});assert.equal(grant.statusCode,201,grant.body);const value=grant.json();
  const directory=await f.call('GET','/api/access-management');assert.equal(directory.statusCode,200,directory.body);const stored=directory.json().tokens.find((item:any)=>item.id===value.collaborator.id);assert.equal(stored.issuedBy,'owner');assert.equal(stored.issuedByName,'Instance owner');assert.deepEqual(stored.scope,key);assert.equal(stored.status,'active');assert.ok(Date.parse(stored.expiresAt)>Date.now());assert.equal(directory.body.includes(value.token),false);assert.equal(directory.body.includes('"hash"'),false);
  const bytes=await readFile(path.join(f.directory,'access-credentials.json'),'utf8');assert.equal(bytes.includes(value.token),false);assert.match(bytes, /"hash": "[a-f0-9]{64}"/);
  const self=await f.call('GET','/api/me/access-tokens',undefined,value.token);assert.equal(self.statusCode,200);assert.equal(self.json().tokens.length,1);assert.equal(self.json().tokens[0].actorId,value.collaborator.id);
  const event=f.audit.page(auditQuerySchema.parse({action:'access.granted'}));assert.equal(event.total,1);assert.equal(JSON.stringify(event).includes(value.token),false);assert.equal(event.items[0]!.actor.id,'owner');
  assert.equal((await f.call('GET','/api/access-management',undefined,value.token)).statusCode,403);assert.equal((await f.call('GET','/api/audit-events',undefined,value.token)).statusCode,403);
});

test('concurrent implicit grants serialize on the latest policy while explicit stale CAS revokes the rejected credential',async t=>{
  const f=await fixture(t),before=(await f.settings.read(key)).commitId,grants=await Promise.all(['One','Two','Three'].map(name=>f.access.grant(key,owner,{name:'Synthetic '+name,role:'annotator'})));
  assert.equal((await f.settings.read(key)).policy.collaborators.length,3);for(const grant of grants)assert.ok(await f.access.resolve(grant.token));
  await assert.rejects(()=>f.access.grant(key,owner,{name:'Synthetic stale grant',role:'editor',expectedCommit:before}),(error:any)=>error.code==='SETTINGS_CONFLICT');assert.equal((await f.settings.read(key)).policy.collaborators.length,3);
});

test('a revoked known person can receive a new scoped credential without changing actor or advancing an unchanged project policy',async t=>{
  const f=await fixture(t),first=await f.access.grant(key,owner,{name:'Synthetic restored actor',role:'annotator'}),head=(await f.settings.read(key)).commitId;await f.access.revokeToken(owner,first.collaborator.id);assert.equal(await f.access.resolve(first.token),undefined);
  const restored=await f.access.grant(key,owner,{existingActorId:first.collaborator.id,role:'annotator'});assert.equal(restored.collaborator.id,first.collaborator.id);assert.equal((await f.access.resolve(restored.token))!.id,first.collaborator.id);assert.equal((await f.settings.read(key)).commitId,head);
});

test('rotation preserves stable actor, immediately invalidates old session, and repository removal revokes all credentials of that actor',async t=>{
  const f=await fixture(t),grant=await f.access.grant(key,owner,{name:'Synthetic rotating person',role:'editor'}),first=await f.access.resolve(grant.token);assert.ok(first);
  const login=await f.app.inject({method:'POST',url:'/api/session',payload:{token:grant.token}}),cookie=String(login.headers['set-cookie']).split(';')[0]!;assert.equal(login.statusCode,200);
  const response=await f.call('POST','/api/me/access-tokens/'+grant.collaborator.id+'/rotate',{},grant.token);assert.equal(response.statusCode,200,response.body);const rotated=response.json(),next=await f.access.resolve(rotated.token);assert.equal(next?.id,first.id);assert.notEqual(next?.credentialId,first.credentialId);assert.equal(await f.access.resolve(grant.token),undefined);
  const oldSession=await f.app.inject({url:'/api/me/access-tokens',headers:{cookie}});assert.equal(oldSession.statusCode,401);
  assert.equal((await f.access.permissions(key,next!)).write,true);assert.equal(f.access.identityDirectory().filter(item=>item.id===first.id).length,1);
  const internalActor:RequestIdentity={id:first.id,name:first.name,kind:'collaborator',source:'bearer'};assert.equal(await f.access.active(internalActor),true);assert.equal((await f.access.permissions(key,internalActor)).write,true,'Task participant validation uses stable actor IDs after rotation');
  await f.access.revoke(key,owner,first.id);assert.equal(await f.access.resolve(rotated.token),undefined);assert.equal(await f.access.active(next!),false);
});

test('existing people retain stable identity across projects while credentials, self-management and revocation stay scoped',async t=>{
  const f=await fixture(t),second={namespace:'oxen',repo:'synthetic-second-project'};await f.provider.createRepo({namespace:second.namespace,name:second.repo,description:'Synthetic independent permission scope',visibility:'private'});
  const first=await f.access.grant(key,owner,{name:'Synthetic shared person',role:'editor'}),secondGrant=await f.access.grant(second,owner,{existingActorId:first.collaborator.id,role:'editor'}),a=(await f.access.resolve(first.token))!,b=(await f.access.resolve(secondGrant.token))!;
  assert.equal(a.id,b.id);assert.notEqual(a.credentialId,b.credentialId);assert.equal((await f.access.permissions(key,a)).write,true);assert.equal((await f.access.permissions(second,b)).write,true);assert.equal((await f.access.permissions(second,a)).read,false);assert.equal((await f.access.permissions(key,b)).read,false);
  assert.equal((await f.call('POST','/api/me/access-tokens/'+b.credentialId+'/rotate',{},first.token)).statusCode,403);assert.equal((await f.call('POST','/api/me/access-tokens/'+b.credentialId+'/revoke',{},first.token)).statusCode,403);
  const visible=(await f.call('GET','/api/me/access-tokens',undefined,first.token)).json().tokens;assert.equal(visible.some((item:any)=>item.id===b.credentialId),false);
  await f.access.revoke(key,owner,a.id);assert.equal(await f.access.resolve(first.token),undefined);assert.ok(await f.access.resolve(secondGrant.token));assert.equal((await f.access.permissions(second,b)).write,true);
});

test('a token cannot manage another person or grant instance permissions; former project administrators cannot manage issued tokens',async t=>{
  const f=await fixture(t),admin=await f.access.grant(key,owner,{name:'Synthetic project admin',role:'admin'}),identity=(await f.access.resolve(admin.token))!,worker=await f.access.grant(key,identity,{name:'Synthetic assigned worker',role:'annotator'}),other=await f.access.grant(key,owner,{name:'Synthetic other',role:'viewer'});
  assert.equal((await f.call('POST','/api/me/access-tokens/'+other.collaborator.id+'/revoke',{},worker.token)).statusCode,403);
  assert.equal((await f.call('POST','/api/access-management/grants',{scope:'instance',name:'Escalation',globalRole:'administrator'},admin.token)).statusCode,403);
  const issued=await f.call('GET','/api/me/access-tokens',undefined,admin.token);assert.equal(issued.json().tokens.some((item:any)=>item.id===worker.collaborator.id),true);assert.equal(issued.json().tokens.some((item:any)=>item.id===other.collaborator.id),false);
  await f.access.setRole(key,owner,admin.collaborator.id,'viewer');assert.equal((await f.call('POST','/api/me/access-tokens/'+worker.collaborator.id+'/revoke',{},admin.token)).statusCode,403);assert.equal((await f.call('POST','/api/me/access-tokens/'+worker.collaborator.id+'/rotate',{},admin.token)).statusCode,403);
});

test('managed instance administrator sessions revoke immediately; auditor receives only macro log access',async t=>{
  const f=await fixture(t),admin=await f.call('POST','/api/access-management/grants',{scope:'instance',name:'Synthetic instance admin',globalRole:'administrator'}),value=admin.json();assert.equal(admin.statusCode,201,admin.body);
  const identity=(await f.access.resolve(value.token))!;assert.equal(identity.kind,'owner');assert.notEqual(identity.id,'owner');assert.equal(f.access.isInstanceAdmin(identity),true);
  const login=await f.app.inject({method:'POST',url:'/api/session',payload:{token:value.token}}),cookie=String(login.headers['set-cookie']).split(';')[0]!;
  assert.equal((await f.app.inject({url:'/api/access-management',headers:{cookie}})).statusCode,200);
  await f.access.revokeToken(owner,value.credential.id);assert.equal((await f.app.inject({url:'/api/access-management',headers:{cookie}})).statusCode,401);assert.equal((await f.access.permissions(key,identity)).admin,false);
  const auditor=await f.access.grantInstance(owner,{name:'Synthetic auditor',globalRole:'auditor'});assert.equal((await f.call('GET','/api/audit-events',undefined,auditor.token)).statusCode,200);assert.equal((await f.call('GET','/api/access-management',undefined,auditor.token)).statusCode,403);assert.equal((await f.access.permissions(key,(await f.access.resolve(auditor.token))!)).read,false);
});

test('managed administrator can rotate its own credential without changing actor or losing management scope',async t=>{
  const f=await fixture(t),granted=await f.access.grantInstance(owner,{name:'Synthetic rotating administrator',globalRole:'administrator'}),before=(await f.access.resolve(granted.token))!;
  const response=await f.call('POST','/api/me/access-tokens/'+granted.credential.id+'/rotate',{},granted.token);assert.equal(response.statusCode,200,response.body);const value=response.json(),after=(await f.access.resolve(value.token))!;
  assert.equal(after.id,before.id);assert.equal(after.kind,'owner');assert.equal(f.access.isInstanceAdmin(after),true);assert.ok(value.credential);assert.equal(value.credential.globalRole,'administrator');assert.equal(await f.access.resolve(granted.token),undefined);assert.equal((await f.call('GET','/api/access-management',undefined,value.token)).statusCode,200);
});

test('instance reissuance trusts only existing instance personnel and preserves role, actor kind and recorded name',async t=>{
  const f=await fixture(t),projectAdmin=await f.access.grant(key,owner,{name:'Synthetic project-only admin',role:'admin'}),original=await f.access.grantInstance(owner,{name:'Synthetic trusted administrator',globalRole:'administrator'});
  await f.access.revokeToken(owner,original.credential.id);
  for(const existingActorId of [projectAdmin.collaborator.id,'00000000-0000-4000-8000-000000000000'])assert.equal((await f.call('POST','/api/access-management/grants',{scope:'instance',existingActorId,globalRole:'administrator'})).statusCode,403);
  assert.equal((await f.call('POST','/api/access-management/grants',{scope:'instance',existingActorId:original.credential.actorId,globalRole:'administrator'},projectAdmin.token)).statusCode,403);
  const mismatch=await f.call('POST','/api/access-management/grants',{scope:'instance',existingActorId:original.credential.actorId,globalRole:'auditor'});assert.equal(mismatch.statusCode,409);assert.equal(mismatch.json().error.code,'INSTANCE_IDENTITY_ROLE_MISMATCH');
  const reissued=await f.call('POST','/api/access-management/grants',{scope:'instance',existingActorId:original.credential.actorId,name:'Untrusted replacement name',globalRole:'administrator'});assert.equal(reissued.statusCode,201,reissued.body);const value=reissued.json();assert.equal(value.credential.actorId,original.credential.actorId);assert.equal(value.credential.name,original.credential.name);assert.notEqual(value.credential.id,original.credential.id);assert.equal((await f.access.resolve(value.token))!.kind,'owner');assert.equal(await f.access.resolve(original.token),undefined);
  const directory=(await f.call('GET','/api/access-management')).json();assert.deepEqual(directory.instanceIdentities.find((item:any)=>item.id===original.credential.actorId),{id:original.credential.actorId,name:original.credential.name,globalRole:'administrator'});assert.equal(directory.instanceIdentities.some((item:any)=>item.id===projectAdmin.collaborator.id),false);assert.deepEqual((await f.call('GET','/api/access-management',undefined,projectAdmin.token)).json().instanceIdentities,[]);
  const auditor=await f.access.grantInstance(owner,{name:'Synthetic trusted auditor',globalRole:'auditor'});await f.access.revokeToken(owner,auditor.credential.id);const replacement=await f.access.grantInstance(owner,{existingActorId:auditor.credential.actorId,globalRole:'auditor'}),identity=(await f.access.resolve(replacement.token))!;assert.equal(identity.id,auditor.credential.actorId);assert.equal(identity.kind,'collaborator');assert.equal(f.access.canReadAudit(identity),true);assert.equal(f.access.isInstanceAdmin(identity),false);assert.equal((await f.access.permissions(key,identity)).read,false);
});

test('cold restore revokes global administrator credentials then bootstrap reissues the same actor and recovers only its private draft and UI checkpoint',async t=>{
  const testsRoot=path.resolve('.data/tests');await mkdir(testsRoot,{recursive:true});const directory=await mkdtemp(path.join(testsRoot,'r10-instance-restore-')),originalControl=path.join(directory,'original/control'),originalFile=path.join(directory,'original/provider/demo.json'),repository={namespace:'local',repo:'synthetic-instance-recovery'},url='/api/repos/local/synthetic-instance-recovery';
  let app:Awaited<ReturnType<typeof createApp>>|undefined;
  t.after(async()=>{await app?.close();if(!path.resolve(directory).startsWith(testsRoot+path.sep))throw new Error('Unsafe recovery fixture cleanup');await rm(directory,{recursive:true,force:true});});
  const provider=new DemoProvider(originalFile);await provider.init();await provider.createRepo({namespace:repository.namespace,name:repository.repo,description:'Synthetic instance identity recovery',visibility:'private'});const initialized=await new DatasetService(provider).initialize(repository,owner,{ref:'main',expectedCommit:(await provider.branches(repository))[0]!.commitId,rows:[{id:'synthetic-one',text:'Synthetic source kept'}],message:'Synthetic recovery dataset'});
  const configure=(control:string)=>loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(control,'state.json'),BFF_TOKEN:token,BFF_TEAM_MODE:'true'});
  app=await createApp(configure(originalControl),provider);
  const call=(method:'GET'|'POST'|'PUT',route:string,payload?:unknown,credential=token)=>app!.inject({method,url:route,headers:{authorization:'Bearer '+credential},...(payload===undefined?{}:{payload})});
  const issued=await call('POST','/api/access-management/grants',{scope:'instance',name:'Synthetic recovering administrator',globalRole:'administrator'});assert.equal(issued.statusCode,201,issued.body);const first=issued.json(),actorId=first.credential.actorId;
  const page=(await call('GET',url+'/dataset?ref=main',undefined,first.token)).json();
  const draftResponse=await call('PUT',url+'/dataset/draft',{ref:'main',expectedCommit:page.commitId,draftRevision:0,operations:[{op:'update',rowId:page.rowIds[0],record:{...page.rows[0],text:'Synthetic private uncommitted value'}}]},first.token);assert.equal(draftResponse.statusCode,200,draftResponse.body);const draft=draftResponse.json().draft;
  const uiResponse=await call('PUT',url+'/dataset/ui-state',{ref:'main',kind:'workbench',revision:0,baseCommit:page.commitId,payload:{unfinishedJson:'{"unfinished":',selectedRow:page.rowIds[0]}},first.token);assert.equal(uiResponse.statusCode,200,uiResponse.body);const ui=uiResponse.json().state;
  await app.close();app=undefined;
  const backup=path.join(directory,'backup');await createColdBackup({sources:[{id:'oxen-demo',root:originalFile,kind:'oxen',required:true},{id:'control',root:originalControl,kind:'control',required:true}],destination:backup,authority:'synthetic-demo',applicationVersion:'0.1.0',oxenVersion:'synthetic-only',assertQuiescent:async()=>assert.equal(app,undefined)});
  const destination=path.join(directory,'restored'),receipt=await restoreBackup({backup,destination,assertIsolated:async target=>{assert.ok(target.startsWith(directory+path.sep));assert.notEqual(target,originalControl);}});assert.equal(receipt.credentialsRevoked,1);
  const restoredControl=path.join(destination,'data/control'),restoredProvider=new DemoProvider(path.join(destination,'data/oxen-demo/demo.json'));await restoredProvider.init();app=await createApp(configure(restoredControl),restoredProvider);
  assert.equal((await call('GET',url+'/dataset/draft/export?ref=main',undefined,first.token)).statusCode,401);assert.equal((await call('GET','/api/access-management',undefined,first.token)).statusCode,401);
  const reissued=await call('POST','/api/access-management/grants',{scope:'instance',existingActorId:actorId,globalRole:'administrator'});assert.equal(reissued.statusCode,201,reissued.body);const second=reissued.json();assert.equal(second.credential.actorId,actorId);assert.notEqual(second.credential.id,first.credential.id);
  const me=(await call('GET','/api/me/access-tokens',undefined,second.token)).json();assert.equal(me.identity.id,actorId);assert.equal(me.identity.kind,'owner');assert.deepEqual((await call('GET',url+'/dataset/draft/export?ref=main',undefined,second.token)).json().draft,draft);assert.deepEqual((await call('GET',url+'/dataset/draft?ref=main',undefined,second.token)).json().draft,draft);assert.deepEqual((await call('GET',url+'/dataset/ui-state?ref=main&kind=workbench',undefined,second.token)).json().state,ui);
  const outsider=(await call('POST','/api/access-management/grants',{scope:'instance',name:'Synthetic other administrator',globalRole:'administrator'})).json();
  for(const otherToken of [token,outsider.token]){assert.equal((await call('GET',url+'/dataset/draft/export?ref=main',undefined,otherToken)).statusCode,404);assert.deepEqual((await call('GET',url+'/dataset/ui-state?ref=main&kind=workbench',undefined,otherToken)).json(),{});}
  assert.equal((await call('GET',url+'/dataset?ref=main',undefined,first.token)).statusCode,401);assert.equal((await restoredProvider.branches(repository))[0]!.commitId,initialized.commitId);
  const credentialFile=JSON.parse(await readFile(path.join(restoredControl,'access-credentials.json'),'utf8'));assert.ok(credentialFile.credentials.find((item:any)=>item.id===first.credential.id).revokedAt);assert.equal(credentialFile.credentials.find((item:any)=>item.id===second.credential.id).actorId,actorId);
});

test('expiry, local-owner fallback and settings final authorization fail closed',async t=>{
  const f=await fixture(t,true);await assert.rejects(()=>f.access.grant(key,owner,{name:'Expired',role:'viewer',expiresAt:new Date(Date.now()-1000).toISOString()}),(error:any)=>error.code==='TOKEN_EXPIRY_INVALID');
  const grant=await f.access.grant(key,owner,{name:'Synthetic short-lived',role:'viewer',expiresAt:new Date(Date.now()+60000).toISOString()}),identity=(await f.access.resolve(grant.token))!;
  const filename=path.join(f.directory,'access-credentials.json'),stored=JSON.parse(await readFile(filename,'utf8'));stored.credentials.find((item:any)=>item.id===grant.collaborator.id).expiresAt=new Date(Date.now()-1000).toISOString();await writeFile(filename,JSON.stringify(stored));await f.access.init();assert.equal(await f.access.active(identity),false);
  const expired=await f.call('GET','/api/me/access-tokens',undefined,grant.token);assert.equal(expired.statusCode,401);
  const admin=await f.access.grant(key,owner,{name:'Synthetic final authorization',role:'admin'}),actor=(await f.access.resolve(admin.token))!,before=(await f.settings.read(key)).commitId,write=f.provider.writeWorkspace.bind(f.provider);f.provider.writeWorkspace=async(...args)=>{const result=await write(...args);await f.access.revokeToken(owner,admin.collaborator.id);return result;};
  await assert.rejects(()=>f.access.setRole(key,actor,grant.collaborator.id,'editor'),(error:any)=>error.status===403);assert.equal((await f.settings.read(key)).commitId,before);assert.deepEqual(await f.provider.workspaces(key),[]);
});

test('macro audit persists, paginates and filters only approved metadata; rejects sensitive detail keys',async t=>{
  const f=await fixture(t);await f.audit.record({action:'project.created',actor:owner,repository:key,targetId:'synthetic-project',details:{operationId:'synthetic-operation',count:3}});await f.audit.record({action:'access.granted',actor:owner,repository:key,targetId:'synthetic-actor'});await f.audit.record({action:'template.published',actor:owner,details:{version:1}});
  const response=await f.call('GET','/api/audit-events?pageSize=1&page=2');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().total,3);assert.equal(response.json().items.length,1);
  const filtered=await f.call('GET','/api/audit-events?project=visual&action=project.created&actor=Synthetic');assert.equal(filtered.json().total,1);assert.equal(filtered.json().items[0].details.count,3);
  await assert.rejects(()=>f.audit.record({action:'project.updated',actor:owner,details:{accessToken:'must not persist'}}),(error:any)=>error.code==='AUDIT_DETAIL_REJECTED');await assert.rejects(()=>f.audit.record({action:'project.updated',actor:owner,details:{content:'must not persist'}}),(error:any)=>error.code==='AUDIT_DETAIL_REJECTED');
  const restarted=new GlobalAuditService(f.audit.filename);await restarted.init();assert.equal(restarted.page(auditQuerySchema.parse({})).total,3);assert.equal((await readFile(f.audit.filename,'utf8')).includes('must not persist'),false);assert.equal((await f.call('GET','/api/audit-events?pageSize=999')).statusCode,400);
});
