import {readFile} from 'node:fs/promises';

/** Freshness is derived from the consistent cut, never from a scheduled task or copy-end timestamp. */
export async function readBackupHealth(filename:string,now=Date.now()){
  let receipt:any;try{receipt=JSON.parse(await readFile(filename,'utf8'));}catch(error){return{status:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'invalid',rpoTargetHours:24,rpoMet:false,independentCopyVerified:false};}
  const cutAt=receipt.value?.cutAt,cut=typeof cutAt==='string'?Date.parse(cutAt):Number.NaN;if(!Number.isFinite(cut)||cut>now+60_000||receipt.value?.localVerified!==true)return{status:'invalid',rpoTargetHours:24,rpoMet:false,independentCopyVerified:false};
  const ageMs=Math.max(0,now-cut),rpoMet=ageMs<=24*3600_000,independentCopyVerified=receipt.offsiteVerified===true&&receipt.value?.encryptedCopy?.cipher==='AES-256-GCM';
  return{status:!rpoMet?'stale':independentCopyVerified?'healthy':'local-only',generation:receipt.value.generation,cutAt,ageMs,rpoTargetHours:24,rpoMet,independentCopyVerified,maintenanceWindowMet:receipt.maintenanceWindowMet===true};
}
