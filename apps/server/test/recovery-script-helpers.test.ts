import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,rm,rmdir,writeFile} from 'node:fs/promises';
import {createColdBackup,restoreBackup} from '../src/backup.js';
import {projectRoot} from '../src/config.js';
import {captureRecoveryInventory,recoveryDatasetErrorCode} from '../../../scripts/recovery-inventory.js';
import {recoveryFailureDiagnostic} from '../../../scripts/recovery-diagnostics.js';
import {verifyReusableRecovery} from '../../../scripts/recovery-reuse.js';

test('recovery accepts stable ApiError metadata from a different build, never native IO errors',async()=>{
 class ForeignApiError extends Error{status=404;code='DATASET_NOT_FOUND';}
 const foreign=new ForeignApiError('synthetic-private-body');assert.equal(recoveryDatasetErrorCode(foreign),'DATASET_NOT_FOUND');
 assert.equal(recoveryDatasetErrorCode(Object.assign(new Error('private'),{code:'EACCES'})),undefined);
 assert.equal(recoveryDatasetErrorCode({status:404,code:'token.with.secret'}),undefined);
 const provider={repos:async()=>[{namespace:'qa',name:'synthetic'}],branches:async()=>[{name:'main',commitId:'fixed-head'}]} as any;
 const inventory=await captureRecoveryInventory(provider,()=>({read:async()=>{throw foreign;}}));
 assert.equal(inventory.repositories[0]?.datasetError,'DATASET_NOT_FOUND');assert.ok(!JSON.stringify(inventory).includes('synthetic-private-body'));
 const io=Object.assign(new Error('private'),{code:'EACCES'});await assert.rejects(()=>captureRecoveryInventory(provider,()=>({read:async()=>{throw io;}})),error=>error===io);
});

test('recovery failure diagnostics omit messages, assertion values and function names',async()=>{
 const filename=path.join(projectRoot,'scripts','ops-recovery-acceptance.ts'),error=Object.assign(new Error('TOKEN_SECRET sample body'),{code:'ENOENT',status:500,actual:'PRIVATE_ACTUAL',expected:'PRIVATE_EXPECTED'});
 error.stack='Error: TOKEN_SECRET\n    at TOKEN_SECRET ('+filename+':4:2)\n    at TOKEN_SECRET ('+path.join(projectRoot,'.data','TOKEN_SECRET.ts')+':1:1)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)';
 const result=await recoveryFailureDiagnostic(error,'assemble-control',projectRoot),text=JSON.stringify(result);
 assert.equal(result.code,'ENOENT');assert.equal(result.status,500);assert.ok(result.frames.includes('at scripts/ops-recovery-acceptance.ts:4:2'));
 for(const secret of ['TOKEN_SECRET','PRIVATE_ACTUAL','PRIVATE_EXPECTED','sample body'])assert.ok(!text.includes(secret));
});

test('completed recovery reuse verifies original hashes and exact credential, share and environment transforms',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'oxen-recovery-helper-'));
 try{
  const source=path.join(root,'source');await mkdir(source);const oxen=path.join(source,'oxen'),drafts=path.join(source,'drafts'),releases=path.join(source,'releases'),config=path.join(source,'config');
  for(const directory of [oxen,drafts,releases,config])await mkdir(directory);
  await writeFile(path.join(oxen,'synthetic.txt'),'synthetic data');await writeFile(path.join(source,'access-credentials.json'),JSON.stringify({version:1,credentials:[{id:'synthetic',secretHash:'synthetic',actorId:'qa'}]}));
  await writeFile(path.join(releases,'records.json'),JSON.stringify({version:1,shares:[{id:'synthetic'}]}));await writeFile(path.join(config,'.env'),'BFF_TOKEN=synthetic-old\nOXEN_AUTH_TOKEN=synthetic-upstream\nPORT=3001\n');
  const backup=path.join(root,'backup'),destination=path.join(root,'restored'),manifest=await createColdBackup({destination:backup,authority:'http://127.0.0.1:3999',applicationVersion:'test',oxenVersion:'test',assertQuiescent:async()=>{},sources:[{id:'oxen',root:oxen,kind:'oxen'},{id:'access-credentials',root:path.join(source,'access-credentials.json'),kind:'control'},{id:'releases',root:releases,kind:'release'},{id:'drafts',root:drafts,kind:'drafts'},{id:'configuration',root:config,kind:'configuration'}]});
  await restoreBackup({backup,destination,assertIsolated:async()=>{}});
  // A pre-fix completed restore can legitimately lack a manifest-proven empty directory.
  await rmdir(path.join(destination,'data','drafts'));
  const result=await verifyReusableRecovery({backup,destination,manifest});assert.equal(result.verification.implicitEmptyRoots,1);assert.equal(result.receipt.credentialsRevoked,1);assert.equal(result.receipt.sharesRevoked,1);assert.equal(result.receipt.sanitizedConfigurations,1);
  const filename=path.join(destination,'data','oxen','synthetic.txt');await writeFile(filename,'tampered data!');await assert.rejects(()=>verifyReusableRecovery({backup,destination,manifest}),{code:'RECOVERY_REUSE_INVALID'});
  await writeFile(filename,'synthetic data');const missing=path.join(destination,'data','releases','records.json');await rm(missing);await assert.rejects(()=>verifyReusableRecovery({backup,destination,manifest}),{code:'RECOVERY_REUSE_INVALID'});
 }finally{const absolute=path.resolve(root),base=path.resolve(os.tmpdir());assert.equal(path.dirname(absolute),base);assert.ok(path.basename(absolute).startsWith('oxen-recovery-helper-'));await rm(absolute,{recursive:true,force:true});}
});
