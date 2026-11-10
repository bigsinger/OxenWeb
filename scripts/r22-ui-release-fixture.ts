/** Disposable browser fixtures only. No native service, real benchmark or credential is read. */
import assert from 'node:assert/strict';
import type {FastifyInstance,HTTPMethods} from 'fastify';
import type {DatasetRelease,ReleaseShare} from '../packages/shared/src/releases.js';
import {DemoProvider} from '../apps/server/src/demo.js';

export const r22BrowserProjects={a:'ai-safety-ui-qa',b:'ai-safety-ui-qa-b',empty:'ai-safety-ui-qa-empty'} as const;
export async function seedR22ReleaseBrowserFixtures(app:FastifyInstance,provider:DemoProvider){
  assert(provider instanceof DemoProvider,'Browser fixtures require the isolated demo provider');
  async function call<T=any>(method:HTTPMethods,url:string,payload?:object):Promise<T>{
    const response=await app.inject({method,url,headers:{'x-oxen-request':'web'},...(payload===undefined?{}:{payload})});
    if(response.statusCode>=300)throw new Error('Synthetic release fixture '+method+' '+url.split('?')[0]+' returned '+response.statusCode);
    return response.statusCode===204?undefined as T:response.json();
  }
  const base=(repo:string)=>'/api/repos/local/'+repo;
  const original=await call('GET',base(r22BrowserProjects.a)+'/dataset?ref=main');
  assert.equal(original.totalRows,12,'The original table fixture must remain exactly twelve rows');
  async function ensureProject(repo:string,rows:number){
    const key={namespace:'local',repo};
    if((await provider.repos()).some(item=>item.namespace==='local'&&item.name===repo))return;
    await call('POST','/api/repos',{namespace:'local',name:repo,description:'Synthetic R22 browser context fixture',visibility:'private'});
    const workspace=await provider.createWorkspace(key,'Synthetic R22 browser baseline','main');
    const records=Array.from({length:rows},(_,index)=>({id:'r22-b-'+index,text:'Synthetic browser context '+index}));
    for(const [filename,content]of Object.entries({'data/samples.jsonl':records.map(row=>JSON.stringify(row)).join('\n')+(rows?'\n':''),'README.md':'# Synthetic R22 browser context\n\nInert acceptance data only.\n','.oxenweb/dataset.json':JSON.stringify({version:1,id:repo,name:repo,canonicalPath:'data/samples.jsonl',readmePath:'README.md',identityField:'id',attachmentFields:[],source:'descriptor',fields:{id:{type:'string'},text:{type:'string'}}}),'.oxenweb/labels.json':JSON.stringify({version:1,columns:[],assignments:[]})}))await provider.writeWorkspace(key,workspace.id,filename,Buffer.from(content));
    await provider.commitWorkspace(key,workspace.id,'Synthetic R22 browser baseline');await provider.deleteWorkspace(key,workspace.id);
  }
  await ensureProject(r22BrowserProjects.b,3);await ensureProject(r22BrowserProjects.empty,0);
  async function ready(repo:string,item:DatasetRelease){const deadline=Date.now()+30000;while(['queued','building'].includes(item.status)){assert(Date.now()<deadline,'Synthetic release build exceeded budget');await new Promise(resolve=>setTimeout(resolve,30));item=await call('GET',base(repo)+'/'+(item.kind==='snapshot'?'snapshots':'releases')+'/'+item.id);}assert.equal(item.status,'ready');return item;}
  async function publication(repo:string,version:string){
    const current=(await call('GET',base(repo)+'/releases')).items.find((item:DatasetRelease)=>item.status==='published') as DatasetRelease|undefined;
    let item=current;
    if(!item){const preview=await call('POST',base(repo)+'/releases/preview',{sourceRef:'main'});item=await call('POST',base(repo)+'/releases',{version,title:'Synthetic '+version,sourceRef:'main',notes:preview.generatedNotes,expectedCommit:preview.commitId,expectedBaselineReleaseId:preview.baselineReleaseId,expectedPlanDigest:preview.planDigest});item=await ready(repo,await call('POST',base(repo)+'/releases/'+item!.id+'/build',{expectedRevision:item!.revision}));item=await call('POST',base(repo)+'/releases/'+item.id+'/publish',{expectedRevision:item.revision});}
    const shares=await call<ReleaseShare[]>('GET',base(repo)+'/releases/'+item!.id+'/shares');
    if(!shares.some(share=>!share.revokedAt&&Date.parse(share.expiresAt)>Date.now())){
      const asset=item!.assets.find(asset=>asset.kind==='data'&&asset.shareable===true)!;assert(asset);
      // Only redacted GET records are retained. Discard the one-time URL immediately.
      await call('POST',base(repo)+'/releases/'+item!.id+'/shares',{assetId:asset.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    }
    return {repo,releaseId:item!.id,shareIds:(await call<ReleaseShare[]>('GET',base(repo)+'/releases/'+item!.id+'/shares')).filter(share=>!share.revokedAt).map(share=>share.id)};
  }
  const a=await publication(r22BrowserProjects.a,'r22-initial-a'),b=await publication(r22BrowserProjects.b,'r22-initial-b');
  let snapshot=(await call('GET',base(r22BrowserProjects.a)+'/snapshots')).items.find((item:DatasetRelease)=>item.status==='ready') as DatasetRelease|undefined;
  if(!snapshot)snapshot=await ready(r22BrowserProjects.a,await call('POST',base(r22BrowserProjects.a)+'/snapshots',{ref:'main'}));
  assert.equal((await call('GET',base(r22BrowserProjects.a)+'/dataset?ref=main')).totalRows,12);
  return {a,b,empty:r22BrowserProjects.empty,snapshotId:snapshot.id,syntheticOnly:true};
}
