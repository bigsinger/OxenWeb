import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {DemoProvider} from '../src/demo.js';
const key={namespace:'oxen',repo:'visual-search'};
async function fixture(t:{after:(action:()=>Promise<void>)=>void}){const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'demo-batch-')),filename=path.join(directory,'state.json'),provider=new DemoProvider(filename);await provider.init();t.after(async()=>{if(!path.resolve(directory).startsWith(root+path.sep))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true});});return {provider,filename};}

test('atomic demo batch stages all files with one durable mutation and matches sequential file/commit effects',async t=>{
 const {provider}=await fixture(t),a=await provider.createWorkspace(key,'Atomic synthetic staging','main'),b=await provider.createWorkspace(key,'Sequential synthetic staging','main'),files=[{path:'synthetic/a.txt',content:Buffer.from('A')},{path:'synthetic/b.jsonl',content:Buffer.from('{"id":"inert"}\n')},{path:'synthetic/a.txt',content:Buffer.from('B')}];
 const internal=provider as unknown as {save:()=>Promise<void>},save=internal.save.bind(provider);let writes=0;internal.save=async()=>{writes++;await save();};
 const batch=await provider.writeWorkspaceBatch(key,a.id,files);assert.equal(writes,1);writes=0;for(const file of files)await provider.writeWorkspace(key,b.id,file.path,file.content);assert.equal(writes,3);const sequential=await provider.workspace(key,b.id);assert.deepEqual(batch.changes,sequential.changes);
 const committed=await provider.commitWorkspace(key,a.id,'Synthetic atomic commit');assert.equal((await provider.raw(key,committed.id,'synthetic/a.txt')).content.toString(),'B');assert.equal((await provider.raw(key,committed.id,'synthetic/b.jsonl')).content.toString(),'{"id":"inert"}\n');
});
test('invalid batch or durable persistence failure leaves the full old in-memory and on-disk workspace',async t=>{
 const {provider,filename}=await fixture(t),workspace=await provider.createWorkspace(key,'Synthetic interrupted staging','main');await provider.writeWorkspace(key,workspace.id,'synthetic/existing.txt',Buffer.from('old'));
 const before=await provider.workspace(key,workspace.id),bytes=await readFile(filename),files=[{path:'synthetic/new.txt',content:Buffer.from('new')},{path:'synthetic/invalid.jsonl',content:Buffer.from('{')}];
 await assert.rejects(()=>provider.writeWorkspaceBatch(key,workspace.id,files));assert.deepEqual(await provider.workspace(key,workspace.id),before);assert.deepEqual(await readFile(filename),bytes);
 const internal=provider as unknown as {save:()=>Promise<void>},save=internal.save;internal.save=async()=>{throw new Error('Synthetic disk write rejected');};
 await assert.rejects(()=>provider.writeWorkspaceBatch(key,workspace.id,[{path:'synthetic/first.txt',content:Buffer.from('one')},{path:'synthetic/second.txt',content:Buffer.from('two')}]),/Synthetic disk/);internal.save=save;
 assert.deepEqual(await provider.workspace(key,workspace.id),before);assert.deepEqual(await readFile(filename),bytes);const restarted=new DemoProvider(filename);await restarted.init();assert.deepEqual(await restarted.workspace(key,workspace.id),before);
});
