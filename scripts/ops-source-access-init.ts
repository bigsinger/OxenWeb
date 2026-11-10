/** Trusted offline bootstrap of generic source restrictions; no retired publishing schema is read. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,projectRoot} from '../apps/server/src/config.js';
import {SourceAccessMarkers} from '../apps/server/src/source-access-markers.js';
import {datasetRepositoryKey} from '../apps/server/src/dataset-route-key.js';

export async function bootstrapSourceAccess(options:{control:string;repositories:Array<{namespace:string;repo:string}>;execute:boolean;initializeEmpty:boolean}){
  const filename=path.join(path.resolve(options.control),'source-access-markers.json');
  const exists=!!await lstat(filename).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;});
  const markers=new SourceAccessMarkers({filename});await markers.init();
  if(!options.execute)return {executed:false,filename,exists,retainedRepositories:options.repositories.length};
  if(!options.repositories.length&&!options.initializeEmpty)throw new Error('Specify --retain namespace/project or explicitly confirm a fresh empty policy with --initialize-empty.');
  let lease:{pid?:number}|undefined;try{lease=JSON.parse(await readFile(path.join(options.control,'.oxen-web-instance.lock'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(lease?.pid){assert.ok(Number.isSafeInteger(lease.pid)&&lease.pid>1,'Invalid instance lease');let running=true;try{process.kill(lease.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')running=false;else throw error;}if(running)throw new Error('Stop the BFF before initializing source-access policy; an active instance holds this control directory.');}
  await markers.retainRestrictions(options.repositories);
  return {executed:true,filename,existingRestrictionsPreserved:true,retainedRepositories:options.repositories.length};
}

async function main(){
  for(const file of ['.env','infra/oxen/local.env'])try{process.loadEnvFile(path.join(projectRoot,file));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const args=process.argv.slice(2),repositories=[];
  for(let index=0;index<args.length;index++){const value=args[index];if(value==='--retain'){if(!args[index+1])throw new Error('--retain requires namespace/project');repositories.push(datasetRepositoryKey(args[++index]!));}else if(value!=='--execute'&&value!=='--initialize-empty')throw new Error('Unknown argument: '+value);}
  const config=loadConfig(),result=await bootstrapSourceAccess({control:path.dirname(config.demoFile),repositories,execute:args.includes('--execute'),initializeEmpty:args.includes('--initialize-empty')});console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Source policy initialization failed');process.exitCode=1;});
