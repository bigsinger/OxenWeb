import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,readdir} from 'node:fs/promises';
import type {BackupManifest,restoreBackup} from '../apps/server/src/backup.js';
type RestoreReceipt=Awaited<ReturnType<typeof restoreBackup>>;
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function hashFile(filename:string){const value=createHash('sha256');for await(const part of createReadStream(filename))value.update(part);return value.digest('hex');}
const fail=()=>{throw Object.assign(new Error('Restored generation validation failed'),{code:'RECOVERY_REUSE_INVALID'});};
/** Reuses only a completed, unstarted restore with every file independently verified. */
export async function verifyReusableRecovery(options:{backup:string;destination:string;manifest:BackupManifest}){
 const {backup,manifest}=options,destination=path.resolve(options.destination),receipt=JSON.parse(await readFile(path.join(destination,'restore-receipt.json'),'utf8')) as RestoreReceipt;
 if(receipt.version!==1||receipt.generation!==manifest.generation||receipt.isolated!==true||receipt.requiresNewCredentials!==true||receipt.requiresNewOwnerToken!==true||receipt.requiresManagedOxenDataPointer!==true||!Number.isFinite(Date.parse(receipt.restoredAt))||receipt.sourceManifestSha256!==await hashFile(path.join(backup,'manifest.json'))||!Array.isArray(receipt.sources)||receipt.sources.length!==manifest.sources.length)fail();
 let implicitEmptyRoots=0;
 for(const source of manifest.sources){
  const restored=receipt.sources.find(item=>item.id===source.id),expected=path.join(destination,'data',source.id);
  if(!restored||restored.kind!==source.kind||restored.directory!==source.directory||path.resolve(restored.root)!==expected)fail();
  if(source.directory)try{const info=await lstat(expected);if(!info.isDirectory()||info.isSymbolicLink())fail();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!manifest.files.some(entry=>entry.sourceId===source.id))implicitEmptyRoots++;else throw error;}
 }
 const expectedFiles=new Set([...manifest.files.map(entry=>entry.path),'restore.env','restore-receipt.json']);
 let counted=0;
 async function walk(directory:string,prefix=''){const info=await lstat(directory);if(info.isSymbolicLink()||!info.isDirectory())fail();for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix?prefix+'/'+entry.name:entry.name,filename=path.join(directory,entry.name);if(entry.isSymbolicLink())fail();if(entry.isDirectory())await walk(filename,relative);else if(!entry.isFile()||!expectedFiles.delete(relative))fail();else counted++;}}
 await walk(destination);if(expectedFiles.size)fail();
 let revoked=0,shares=0,sanitized=0;
 for(const entry of manifest.files){
  const filename=path.join(destination,...entry.path.split('/')),source=manifest.sources.find(item=>item.id===entry.sourceId)!;let expectedHash=entry.sha256,expectedSize=entry.size;
  const credentials=path.posix.basename(entry.path)==='access-credentials.json',release=path.posix.basename(entry.path)==='records.json'&&(entry.sourceId==='releases'||entry.path.endsWith('/releases/records.json')),configuration=source.kind==='configuration'&&['.env','local.env'].includes(path.posix.basename(entry.path));
  if(credentials||release||configuration){
   let text=await readFile(path.join(backup,...entry.path.split('/')),'utf8');
   if(credentials||release){const value=JSON.parse(text),items=credentials?value.credentials:value.shares;if(!Array.isArray(items))fail();for(const item of items)if(!item.revokedAt){item.revokedAt=receipt.restoredAt;if(credentials)revoked++;else shares++;}text=JSON.stringify(value,null,2)+'\n';}
   if(configuration){const lines=text.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?(?:BFF_TOKEN|BFF_TEAM_MODE|OXEN_AUTH_TOKEN|OXEN_BACKUP_KEY)\s*=/.test(line));lines.push('BFF_TEAM_MODE=true','# RESTORE: configure a NEW BFF_TOKEN and required upstream/backup secrets before starting.');text=lines.join('\n')+'\n';sanitized++;}
   expectedHash=hash(text);expectedSize=Buffer.byteLength(text);
  }
  const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size!==expectedSize||await hashFile(filename)!==expectedHash)fail();
 }
 const environment='BFF_TEAM_MODE=true\n# Configure a new protected BFF_TOKEN before enabling the restored instance.\n';
 if(await hashFile(path.join(destination,'restore.env'))!==hash(environment)||receipt.credentialsRevoked!==revoked||receipt.sharesRevoked!==shares||receipt.sanitizedConfigurations!==sanitized)fail();
 return{receipt,verification:{generation:manifest.generation,restoredFilesVerified:counted,sourceFilesVerified:manifest.files.length,implicitEmptyRoots,credentialsAndSharesRemainRevoked:true,contentLogged:false}};
}
