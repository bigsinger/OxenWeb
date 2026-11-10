import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {RestrictedMasterAccess} from '../src/restricted-master-access.js';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {DemoProvider} from '../src/demo.js';
import {ApiError} from '../src/errors.js';
import type {RequestIdentity,RepositoryPermissions} from '../../../packages/shared/src/index.js';

test('a restricted master closes every source route including old refs and new aliases; release exits stay asset-authorized',async t=>{
  const app=Fastify();t.after(()=>app.close());let hidden=false,admin=false,active=true,restricted=true,uncertain=false;
  app.addHook('onRequest',async request=>{request.oxenIdentity={id:'synthetic-viewer',name:'Synthetic QA',kind:'collaborator',source:'bearer'};});
  const guard=new RestrictedMasterAccess({permissions:async()=>({read:active,write:false,admin,role:'viewer',capabilities:{'release.hidden':hidden}} as RepositoryPermissions)},()=>{if(uncertain)throw new ApiError(503,'EVALUATION_POLICY_UNCERTAIN','Synthetic uncertain policy');return restricted;});guard.install(app);
  app.all('/api/repos/:namespace/:repo/*',async()=>({visible:true}));
  const paths=['raw?ref=old&path=data/samples.jsonl','file','tree','commits/old','diff','query','dataset','dataset/query','dataset/draft/query','dataset/ui-state','workspaces','schema','history/restore/preview','future-source-alias','dataset%2Freleases'];
  for(const source of paths){const result=await app.inject('/api/repos/local/private-master/'+source);assert.equal(result.statusCode,403,source);assert.equal(result.json().code,'RESTRICTED_MASTER_SOURCE_REQUIRED');}
  for(const exit of ['releases','releases/synthetic/assets/nonhidden','snapshots/synthetic/assets/nonhidden'])assert.equal((await app.inject('/api/repos/local/private-master/'+exit)).statusCode,200);
  hidden=true;assert.equal((await app.inject('/api/repos/local/private-master/raw')).statusCode,200);
  hidden=false;admin=true;assert.equal((await app.inject('/api/repos/local/private-master/raw')).statusCode,200);
  active=false;assert.equal((await app.inject('/api/repos/local/private-master/raw')).statusCode,403,'a revoked privileged identity must not retain source access');
  active=true;admin=false;restricted=false;assert.equal((await app.inject('/api/repos/local/private-master/raw')).statusCode,200);
  restricted=true;uncertain=true;assert.equal((await app.inject('/api/repos/local/private-master/raw')).statusCode,503,'unknown control state cannot fall back to open access');
});

test('actual app hides managed masters from QA catalog and denies raw/history/search even at older branches',async t=>{
  const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'restricted-master-'));
  const config=loadConfig({DEMO_MODE:'true',DEMO_DATA_FILE:path.join(directory,'state.json'),BFF_TOKEN:'synthetic-restricted-owner'}),provider=new DemoProvider(config.demoFile),app=await createApp(config,provider);
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});});
  const call=(method:'GET'|'POST',url:string,payload?:unknown,token='synthetic-restricted-owner')=>app.inject({method,url,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});
  const base='/api/repos/local/restricted-master';
  const created=await call('POST','/api/repos',{namespace:'local',name:'restricted-master',visibility:'private'});assert.equal(created.statusCode,201,created.body);
  const branches=await call('GET',base+'/branches'),old=branches.json()[0].commitId;
  const initialized=await call('POST',base+'/dataset/initialize-empty',{ref:'main',expectedCommit:old});assert.equal(initialized.statusCode,200,initialized.body);
  const grant=await call('POST',base+'/access',{name:'Synthetic download-only QA',role:'viewer'});assert.equal(grant.statusCode,201,grant.body);const token=grant.json().token;
  const listing=await call('GET','/api/repos',undefined,token);assert.equal(listing.statusCode,200);assert.equal(listing.json().some((entry:{name:string})=>entry.name==='restricted-master'),false);
  for(const tail of ['', '/dataset?ref=main','/tree?ref='+old,'/raw?ref='+old+'&path=README.md','/commits?ref=main','/diff?base='+old+'&head=main']){const result=await call('GET',base+tail,undefined,token);assert.equal(result.statusCode,403,tail+result.body);assert.equal(result.json().error.code,'RESTRICTED_MASTER_SOURCE_REQUIRED');}
  assert.equal((await call('POST',base+'/query',{ref:'main',prompt:'count',engine:'rules'},token)).statusCode,403);
  assert.equal((await call('GET',base+'/releases',undefined,token)).statusCode,200);
  assert.equal((await call('GET',base+'/dataset?ref=main')).statusCode,200);
});
