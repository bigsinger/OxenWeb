/** Side-effect adapters are explicit so a failed copy cannot leave services stopped silently. */
export async function coordinateColdBackup<T>(options:{drain:()=>Promise<void>;stopBff:()=>Promise<void>;stopOxen:()=>Promise<void>;createAndVerify:()=>Promise<T>;startOxen:()=>Promise<void>;startBff:()=>Promise<void>;resume:()=>Promise<void>}){
  const began=Date.now(),steps:Array<{step:string;at:string}>=[];let drainAttempted=false,bffStopAttempted=false,oxenStopAttempted=false,value:T|undefined,failure:unknown;const recoveryErrors:string[]=[];
  const step=(name:string)=>steps.push({step:name,at:new Date().toISOString()});
  try{step('drain');drainAttempted=true;await options.drain();step('stop-bff');bffStopAttempted=true;await options.stopBff();step('stop-oxen');oxenStopAttempted=true;await options.stopOxen();step('copy-and-verify');value=await options.createAndVerify();}
  catch(error){failure=error;}
  finally{if(oxenStopAttempted){step('start-oxen');try{await options.startOxen();}catch{recoveryErrors.push('OXEN_RESTART_FAILED');}}if(bffStopAttempted){step('start-bff');try{await options.startBff();}catch{recoveryErrors.push('BFF_RESTART_FAILED');}}if(drainAttempted){step('resume');try{await options.resume();}catch{recoveryErrors.push('RESUME_FAILED');}}}
  if(failure||recoveryErrors.length){const error=new Error(failure instanceof Error?failure.message:'Backup maintenance could not finish');Object.assign(error,{recoveryErrors,steps});throw error;}
  const elapsedMs=Date.now()-began;return{value:value!,elapsedMs,maintenanceWindowMet:elapsedMs<=30*60_000,steps};
}
