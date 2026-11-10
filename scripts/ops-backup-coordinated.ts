/** Owner-only cold maintenance. Defaults to a reviewable plan; use --execute to operate. */
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {mkdir,open,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {coordinateColdBackup} from '../apps/server/src/backup-coordinator.js';
import {pruneColdBackups} from '../apps/server/src/backup.js';
import {durableWriteJson} from '../apps/server/src/durable-store.js';
import {runtimeAuthority} from '../apps/server/src/instance-runtime.js';
for(const filename of [path.join(projectRoot,'.env'),path.join(projectRoot,'infra/oxen/local.env')])try{process.loadEnvFile(filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const config=loadConfig(),args=process.argv.slice(2),argument=(key:string)=>{const index=args.indexOf('--'+key);return index<0?undefined:args[index+1];},stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),localRoot=path.resolve(argument('destination-root')??process.env.OXEN_BACKUP_LOCAL_ROOT??path.join(projectRoot,'.backups')),encryptedRoot=argument('encrypted-root')??process.env.OXEN_BACKUP_ENCRYPTED_ROOT,destination=path.join(localRoot,stamp),encryptedCopy=encryptedRoot?path.join(path.resolve(encryptedRoot),stamp+'.owb'):undefined;
const origin='http://'+(['0.0.0.0','::'].includes(config.host)?'127.0.0.1':config.host)+':'+config.port;
const operationsDirectory=path.join(path.dirname(config.demoFile),'operations');
async function run(args:string[]){return new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:projectRoot,env:process.env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',data=>{if(output.length<1024*1024)output+=data;});child.stderr.on('data',data=>{if(error.length<1024*1024)error+=data;});child.once('error',reject);child.once('close',code=>code===0?resolve(output):reject(new Error(error.trim()||'Managed backup command failed')));});}
async function reachable(url:string){try{return(await fetch(url,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}}
async function maintenance(kind:'drain'|'resume'){const response=await fetch(origin+'/api/maintenance/'+kind,{method:'POST',headers:{'content-type':'application/json','x-oxen-request':'web',...(config.token?{authorization:'Bearer '+config.token}:{})},body:'{}',signal:AbortSignal.timeout(60_000)});if(!response.ok)throw new Error('Owner maintenance '+kind+' rejected ('+response.status+')');return response.json();}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code==='EPERM';}};
let releaseMaintenance:(()=>Promise<void>)|undefined;
async function acquireMaintenance(){const filename=path.join(path.dirname(config.demoFile),'.backup-maintenance.lock'),nonce=randomUUID();for(let attempt=0;attempt<3;attempt++)try{const handle=await open(filename,'wx',0o600);try{await handle.writeFile(JSON.stringify({version:1,pid:process.pid,nonce}));await handle.sync();}finally{await handle.close();}releaseMaintenance=async()=>{try{const current=JSON.parse(await readFile(filename,'utf8'));if(current.pid===process.pid&&current.nonce===nonce)await rm(filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}};return;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const raw=await readFile(filename,'utf8'),current=JSON.parse(raw);if(current.version!==1||!Number.isInteger(current.pid)||current.pid<2||alive(current.pid))throw new Error('Another backup maintenance operation is active or its lock needs review');if(await readFile(filename,'utf8')===raw)await rm(filename);}throw new Error('Backup maintenance lock contention');}
async function waitUntil(check:()=>Promise<boolean>,timeout=30_000){const end=Date.now()+timeout;while(!await check()){if(Date.now()>end)throw new Error('Managed service transition timed out');await new Promise(resolve=>setTimeout(resolve,200));}}
try{
 if(!args.includes('--execute')){console.log(JSON.stringify({operation:'coordinated-cold-backup-plan',bff:origin,upstream:config.upstream,destination,encryptedCopy:encryptedCopy??'not-configured',retention:'7 daily + 4 weekly',sequence:['owner drain','verify local BFF lease/PID','stop drained BFF','stop managed Oxen','whole generation copy/checksum','encrypted mirror if configured','restart managed Oxen','restart exact built BFF','resume writes','prune only verified expired local generations'],executeFlagRequired:true,offsiteVerified:false},null,2));process.exit(0);}
 if(config.demo)throw new Error('Coordinated managed maintenance is for the live instance; demo uses the isolated backup API');
 if(encryptedCopy&&(!process.env.OXEN_BACKUP_KEY||Buffer.from(process.env.OXEN_BACKUP_KEY,'base64').length!==32))throw new Error('Configure a protected 32-byte OXEN_BACKUP_KEY before stopping services');
 const managed=JSON.parse(await readFile(path.join(projectRoot,'infra/oxen/run/server.json'),'utf8'));if(runtimeAuthority({...config,upstream:managed.origin})!==runtimeAuthority(config))throw new Error('The configured upstream is not the managed local server');
 process.env.OXEN_LOCAL_PORT=String(managed.port);if(managed.distribution)process.env.OXEN_WSL_DISTRIBUTION=managed.distribution;
 const compiled=path.join(projectRoot,'apps/server/dist/apps/server/src/index.js');await readFile(compiled);let pid=0;await mkdir(operationsDirectory,{recursive:true});
 await acquireMaintenance();
 const result=await coordinateColdBackup({
  drain:async()=>{const state=await maintenance('drain');if(state.activeWrites!==0||!Number.isInteger(state.pid)||state.pid<2)throw new Error('Maintenance did not return a drained owner-verified process');const lock=JSON.parse(await readFile(path.join(path.dirname(config.demoFile),'.oxen-web-instance.lock'),'utf8'));if(lock.pid!==state.pid||lock.controlRoot!==await realpath(path.dirname(config.demoFile))||lock.authority!==runtimeAuthority(config))throw new Error('Drained process does not match this control/authority lease');pid=state.pid;},
  stopBff:async()=>{if(!pid)throw new Error('BFF PID was not verified');process.kill(pid,'SIGTERM');await waitUntil(async()=>!alive(pid));},
  stopOxen:async()=>{await run(['--import','tsx',path.join(projectRoot,'scripts/ops-recovery-capture.ts')]);await run([path.join(projectRoot,'scripts/oxen.mjs'),'stop']);},
  createAndVerify:async()=>{const output=await run(['--import','tsx',path.join(projectRoot,'scripts/ops-backup.ts'),'create','--destination',destination,...(encryptedCopy?['--encrypted-copy',encryptedCopy]:[])]);return JSON.parse(output.trim().split(/\r?\n/).at(-1)!);},
  startOxen:async()=>{await run([path.join(projectRoot,'scripts/oxen.mjs'),'start']);},
  startBff:async()=>{if(await reachable(origin+'/api/health'))return;const stdout=openSync(path.join(operationsDirectory,'backup-bff.log'),'a'),stderr=openSync(path.join(operationsDirectory,'backup-bff-error.log'),'a');const child=spawn(process.execPath,[compiled],{cwd:projectRoot,env:process.env,windowsHide:true,shell:false,detached:true,stdio:['ignore',stdout,stderr]});closeSync(stdout);closeSync(stderr);child.unref();await waitUntil(()=>reachable(origin+'/api/health'));},
  resume:async()=>{await maintenance('resume');},
 });
 const retention=await pruneColdBackups(localRoot),receipt={...result,retention,completedAt:new Date().toISOString(),destination,encryptedCopy:encryptedCopy??null,offsiteVerified:false,requiresOffsiteAcceptance:true};await durableWriteJson(path.join(operationsDirectory,'last-backup.json'),receipt);console.log(JSON.stringify(receipt));if(!result.maintenanceWindowMet)process.exitCode=1;
}catch(error){console.error(error instanceof Error?error.message:'Coordinated backup failed');if(error&&typeof error==='object'&&'recoveryErrors'in error)console.error(JSON.stringify({recoveryErrors:error.recoveryErrors}));process.exitCode=1;}
finally{await releaseMaintenance?.();}
