import {nextTick,watch,type WatchSource} from 'vue';

/** Public identity metadata only. This context is never a raw token or a private-draft owner key. */
export interface AccessIdentity {id:string;kind:string;credentialId?:string}
export const actorContext=(identity?:AccessIdentity|null)=>JSON.stringify([identity?.kind??'guest',identity?.id??'guest']);
export const credentialContext=(identity?:AccessIdentity|null)=>JSON.stringify([identity?.kind??'guest',identity?.id??'guest',identity?.credentialId??null]);
export const repositoryQueryKey=(identity?:AccessIdentity|null)=>['repos',credentialContext(identity)] as const;

export function routedAccessContext(identity:AccessIdentity|null|undefined,routeName:unknown,namespace:unknown,repository:unknown){
  // Access pages consume a one-time credential after self-rotation. They clear their own old
  // state synchronously; all other routed page instances must be discarded on scope changes.
  const accessPage=routeName==='access'||routeName==='my-tokens';
  return JSON.stringify([accessPage?actorContext(identity):credentialContext(identity),String(namespace??''),String(repository??'')]);
}

export function watchCredentialContext(identity:WatchSource<AccessIdentity|null|undefined>,reset:()=>void){
  return watch(()=>credentialContext(typeof identity==='function'?identity():identity.value),reset,{immediate:true,flush:'sync'});
}

export function createContextLoadGate(current:()=>AccessIdentity|null|undefined){
  let version=0;
  return {
    invalidate(){version++;},
    begin(){return {version:++version,context:credentialContext(current())};},
    accepts(ticket:{version:number;context:string}){return ticket.version===version&&ticket.context===credentialContext(current());},
  };
}

interface RotationResult {token:string;credential:{id:string;actorId:string}}
/** A late response from the previous scope must never log in or reveal a token in the new scope. */
export async function rotateForCurrentContext(options:{current:()=>AccessIdentity|null|undefined;credentialId:string;rotate:()=>Promise<RotationResult>;login:(token:string)=>Promise<void>}){
  const initial=options.current();if(!initial)return;
  const before={...initial},key=credentialContext(before),self=before.credentialId===options.credentialId,result=await options.rotate();
  if(credentialContext(options.current())!==key)return;
  if(self){
    if(result.credential.actorId!==before.id)return;
    await options.login(result.token);
  }
  // Run synchronous context clearing and the render cycle before returning the new once-only value.
  await nextTick();
  const expected=self?{...before,credentialId:result.credential.id}:before;
  return credentialContext(options.current())===credentialContext(expected)?result.token:undefined;
}
