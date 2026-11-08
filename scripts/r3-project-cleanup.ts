/** Exact, user-approved R3 cleanup. Requires an independently verified offline backup. */
import createClient from 'openapi-fetch';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { LiveProvider } from '../apps/server/src/live.js';
import type { paths } from '../packages/contracts/src/oxen.js';

export const candidates = [
  'audit-conflict-1794094549502','audit-conflict-1794094608883','bff-provision-1794064362702','bff-provision-1794066967909','bff-provision-1794094742522',
  'merge-request-check-1794095407299','merge-request-check-1794095782634','merge-request-check-1794096042918','settings-access-check-1794067096537','settings-access-check-1794096169582',
  'r2-flat-proof-probe-1794111877343','r2-flat-seeded-parent-1794112244688','r2-flat-seeded-reviews-1794112246657','r2-legacy-config-92e7d01e','r2-native-resolution-f5953c0d','r2-native-resolution-7feb0d7d',
  'r2-workflow-acceptance-mw7b7l79-fea663','r2-workflow-acceptance-mw7b9k6q-1d7d37','r2-workflow-acceptance-mw7bgp7u-91b925','r2-workflow-acceptance-mw7c8f26-220086','r2-workflow-acceptance-mw7ch3pd-4d0410',
] as const;
for (const filename of ['.env','infra/oxen/local.env']) { try { process.loadEnvFile(path.join(projectRoot,filename)); } catch(cause) { if((cause as NodeJS.ErrnoException).code!=='ENOENT') throw cause; } }
const config = loadConfig();
if(config.demo || config.upstream!=='http://127.0.0.1:3002') throw new Error('Only the managed local real Oxen server is allowed.');
const folder=path.resolve(process.argv[3]??path.join(projectRoot,'.data/backups/r3-cleanup-20261108'));
if(!folder.startsWith(path.join(projectRoot,'.data/backups')+path.sep)) throw new Error('Backup folder must stay inside the approved local backup directory.');
await mkdir(folder,{recursive:true});
const provider=new LiveProvider(config); await provider.init();
const filename=path.join(folder,'inventory.json');
async function inventory(){
 const repos=await provider.repos('local'),records=[];
 for(const name of candidates){const item=repos.find(item=>item.name===name);if(!item)throw new Error('Expected candidate is absent: '+name);const key={namespace:'local',repo:name};records.push({namespace:'local',repo:name,branches:await provider.branches(key),workspaces:await provider.workspaces(key)});}
 return {version:1,capturedAt:new Date().toISOString(),allProjects:repos.map(item=>({namespace:item.namespace,name:item.name})),candidates:records};
}
if(process.argv[2]==='inventory'){
 await writeFile(filename,JSON.stringify(await inventory(),null,2),{flag:'wx',mode:0o600});console.log('Captured 21 exact candidates and their branch/workspace state.');
}else if(process.argv[2]==='delete'){
 const verified=JSON.parse(await readFile(path.join(folder,'backup-verified.json'),'utf8'));
 if(verified.verified!==true||!verified.archives?.length)throw new Error('No verified offline backup receipt.');
 const before=JSON.parse(await readFile(filename,'utf8')),now=await inventory();
 if(JSON.stringify(before.candidates)!==JSON.stringify(now.candidates)||JSON.stringify(before.allProjects)!==JSON.stringify(now.allProjects))throw new Error('Repository state changed after backup; no deletion executed.');
 const api=createClient<paths>({baseUrl:config.upstream,headers:config.upstreamToken?{Authorization:`Bearer ${config.upstreamToken}`}:{}}),removed=[];
 for(const name of candidates){
  const params={path:{namespace:'local',repo_name:name}};
  const result=await api.DELETE('/api/repos/{namespace}/{repo_name}',{params});
  if(!result.response.ok)throw new Error(`Delete rejected for ${name}: ${result.response.status}`);
  let absent=false;
  for(let attempt=0;attempt<60;attempt++){const check=await api.GET('/api/repos/{namespace}/{repo_name}',{params});if(check.response.status===404){absent=true;break;}if(!check.response.ok)throw new Error('Deletion verification failed: '+name);await new Promise(resolve=>setTimeout(resolve,500));}
  if(!absent)throw new Error('Deletion still pending: '+name);removed.push(name);
 }
 const remaining=await provider.repos('local'),expected=before.allProjects.filter((item:{name:string})=>!candidates.includes(item.name as typeof candidates[number]));
 if(JSON.stringify(remaining.map(item=>item.name).sort())!==JSON.stringify(expected.map((item:{name:string})=>item.name).sort()))throw new Error('Unexpected remaining repository inventory.');
 await writeFile(path.join(folder,'deletion-result.json'),JSON.stringify({version:1,removed,remaining:remaining.map(item=>item.name),completedAt:new Date().toISOString()},null,2),{mode:0o600});
 console.log(`Deleted ${removed.length} exact synthetic repositories; preserved ${remaining.length} repositories.`);
}else if(process.argv[2]==='control-plane'){
 const receipt=JSON.parse(await readFile(path.join(folder,'deletion-result.json'),'utf8'));
 if(JSON.stringify(receipt.removed)!==JSON.stringify(candidates))throw new Error('Exact deletion receipt required.');
 const ids=new Set(candidates.map(name=>'local/'+name)),changes=[];
 const mappings:[string,string[]][]=[['live-extensions.json',['metadata','annotations']],['repository-policy-branches.json',['branches']]];
 for(const [name,keys]of mappings){const target=path.join(projectRoot,'.data',name),state=JSON.parse(await readFile(target,'utf8'));let removed=0;for(const field of keys)for(const id of Object.keys(state[field]??{}))if(ids.has(id)){delete state[field][id];removed++;}if(removed){await writeFile(target+'.r3.tmp',JSON.stringify(state),{mode:0o600});await rename(target+'.r3.tmp',target);}changes.push({file:name,removed});}
 const target=path.join(projectRoot,'.data/live-workspace-branches.json'),state=JSON.parse(await readFile(target,'utf8'));let removed=0;for(const id of Object.keys(state))if([...ids].some(prefix=>id.startsWith(prefix+'/'))){delete state[id];removed++;}await writeFile(target+'.r3.tmp',JSON.stringify(state),{mode:0o600});await rename(target+'.r3.tmp',target);changes.push({file:path.basename(target),removed});
 const requestsFile=path.join(projectRoot,'.data/merge-requests.json'),requests=JSON.parse(await readFile(requestsFile,'utf8')),old=requests.requests.length;requests.requests=requests.requests.filter((item:{namespace:string;repo:string})=>!ids.has(item.namespace+'/'+item.repo));await writeFile(requestsFile+'.r3.tmp',JSON.stringify(requests),{mode:0o600});await rename(requestsFile+'.r3.tmp',requestsFile);changes.push({file:path.basename(requestsFile),removed:old-requests.requests.length});
 await writeFile(path.join(folder,'control-plane-cleanup.json'),JSON.stringify({changes,completedAt:new Date().toISOString()},null,2),{mode:0o600});console.log(JSON.stringify(changes));
}else throw new Error('Use inventory, delete or control-plane with a backup folder.');
