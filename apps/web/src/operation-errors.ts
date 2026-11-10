import {ref} from 'vue';
export const operationIssue=ref<{id:string;code:string;message:string}>();
/** Read-only planning endpoints and credentials never get a write-retry affordance. */
export function tracksOperation(path:string,method:string){
  if(!['POST','PUT','PATCH'].includes(method.toUpperCase()))return false;
  if(path==='/repos'&&method.toUpperCase()==='POST')return true;
  if(/^\/governance\//.test(path))return true;
  return /^\/repos\/[^/]+\/[^/]+(?:$|\/(?:readme$|project-labels$|push$|merge$|history\/restore$|branches$|lifecycle\/(?:remove|restore)$|schema\/(?:layers|bind)$|dataset\/(?:save|draft\/commit|initialize-empty|fields|import\/[^/]+\/commit)$|workspaces\/[^/]+\/commit$|merge-requests\/[^/]+\/merge$|releases(?:\/[^/]+(?:\/(?:build|publish|withdraw))?)?$|snapshots(?:\/[^/]+\/build)?$))/.test(path.split('?')[0]!);
}
