const allowed=new Set(['requestId','operationId','actorId','namespace','repo','ref','code','durationMs','count','mode','version','pid']);
/** Fixed operational metadata only. Callers must never pass bodies, error objects, tokens or query text. */
export function operationalLog(event:string,metadata:Record<string,unknown>={}){
  if(!/^[a-z][a-z0-9_.-]{1,79}$/.test(event))throw new Error('Invalid operational event');const details:Record<string,string|number|boolean>={};for(const [key,value]of Object.entries(metadata)){if(!allowed.has(key))continue;if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')details[key]=value;else if(typeof value==='string')details[key]=value.replace(/[\r\n]/g,' ').slice(0,256);}process.stderr.write(JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');
}
