import {ref,shallowRef} from 'vue';
import type {DatasetRelease} from '../../../packages/shared/src/releases';

/** A request can update only the same identity, project, list and selection it started in. */
export function createReleaseRequestScope(context:()=>string){
  let epoch=0;
  return {capture(){const key=context(),version=epoch;return ()=>version===epoch&&key===context();},invalidate(){epoch++;}};
}

/** Independent read state: background refreshes never erase an action's separate error. */
export function createReleaseReader<T>(options:{context:()=>string;request:()=>Promise<T>;accept:(value:T)=>void}){
  const loading=ref(false),error=ref(''),value=shallowRef<T>();let sequence=0;
  const scope=createReleaseRequestScope(options.context);
  async function read(){const generation=++sequence,current=scope.capture();loading.value=true;
    try{const result=await options.request();if(generation!==sequence||!current())return {ok:false,stale:true} as const;
      value.value=result;error.value='';options.accept(result);return {ok:true,value:result} as const;
    }catch(cause){if(generation!==sequence||!current())return {ok:false,stale:true} as const;error.value=(cause as Error).message;return {ok:false,error:cause as Error} as const;}
    finally{if(generation===sequence&&current())loading.value=false;}
  }
  return {loading,error,value,read,invalidate(){sequence++;scope.invalidate();loading.value=false;},reset(){sequence++;scope.invalidate();loading.value=false;error.value='';value.value=undefined;}};
}

/** Retain a confirmed write response immediately, including when its following GET fails. */
export function retainReleaseResult(items:DatasetRelease[],saved:DatasetRelease){
  if(items.some(item=>item.id===saved.id&&item.revision>saved.revision))return items;
  return [saved,...items.filter(item=>item.id!==saved.id&&!(saved.kind==='release'&&saved.status==='published'&&item.kind==='release'&&item.status==='published'))];
}

/** Saving and validation are sequential. Failed validation never creates a second candidate. */
export function createReleaseCandidateSaver(){
  const running=new Set<string>();
  return {async save(options:{context?:string;write:()=>Promise<DatasetRelease>;build?:(saved:DatasetRelease)=>Promise<DatasetRelease>;accept:(saved:DatasetRelease)=>void;current:()=>boolean}){
    const key=options.context??'default';
    if(running.has(key))return {state:'busy'} as const;running.add(key);
    try{const saved=await options.write();if(!options.current())return {state:'stale'} as const;options.accept(saved);
      if(!options.build)return {state:'saved',value:saved} as const;
      try{const queued=await options.build(saved);if(!options.current())return {state:'stale'} as const;options.accept(queued);return {state:'queued',value:queued} as const;}
      catch(cause){if(!options.current())return {state:'stale'} as const;return {state:'build-failed',value:saved,error:cause as Error} as const;}
    }finally{running.delete(key);}
  }};
}

export function releaseListEmptyState(total:number,filtered:boolean,kind:'releases'|'snapshots'){
  return filtered&&total>0?{title:'没有匹配的版本',clear:true,create:false}:kind==='snapshots'?{title:'尚未创建工作快照',clear:false,create:false}:{title:'尚未发布版本',clear:false,create:true};
}
