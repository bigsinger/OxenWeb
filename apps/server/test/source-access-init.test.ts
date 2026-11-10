import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {bootstrapSourceAccess} from '../../../scripts/ops-source-access-init.js';
import {SourceAccessMarkers} from '../src/source-access-markers.js';

async function temporary(t:{after:(fn:()=>Promise<void>)=>void}){const root=path.resolve('.data/tests');await mkdir(root,{recursive:true});const control=await mkdtemp(path.join(root,'source-bootstrap-'));t.after(async()=>{assert.ok(control.startsWith(root+path.sep));await rm(control,{recursive:true,force:true});});return control;}
test('source-policy plan is read-only and explicit empty bootstrap never removes retained restrictions',async t=>{
  const control=await temporary(t),base={control,repositories:[],execute:false,initializeEmpty:false};assert.equal((await bootstrapSourceAccess(base)).executed,false);await assert.rejects(readFile(path.join(control,'source-access-markers.json')));
  await assert.rejects(()=>bootstrapSourceAccess({...base,execute:true}),/explicitly confirm/);
  await bootstrapSourceAccess({...base,execute:true,initializeEmpty:true});await bootstrapSourceAccess({...base,execute:true,repositories:[{namespace:'local',repo:'synthetic-protected'}]});await bootstrapSourceAccess({...base,execute:true,initializeEmpty:true});
  const markers=new SourceAccessMarkers({filename:path.join(control,'source-access-markers.json')});await markers.init();assert.equal(markers.isRestricted({namespace:'local',repo:'synthetic-protected'}),true);
});
test('offline source-policy bootstrap refuses an active BFF control lease without writing a marker',async t=>{
  const control=await temporary(t);await writeFile(path.join(control,'.oxen-web-instance.lock'),JSON.stringify({pid:process.pid}));await assert.rejects(()=>bootstrapSourceAccess({control,repositories:[],execute:true,initializeEmpty:true}),/Stop the BFF/);await assert.rejects(readFile(path.join(control,'source-access-markers.json')));
});
