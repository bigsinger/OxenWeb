import { defaultPathSerializer } from 'openapi-fetch';
import { safeSegment } from './safety.js';

// Fixed 0.67 service routes use Actix `{name:.*}` for these contract parameters.
// openapi-fetch 0.15 has no pathSerializer option; use its supported onRequest middleware.
const repository='/api/repos/{namespace}/{repo_name}';
const wildcards:Record<string,readonly string[]>={
  [repository+'/workspaces/{workspace_id}/files/{path}']:['path'],
  [repository+'/workspaces/{workspace_id}/copy/{path}']:['path'],
  [repository+'/workspaces/{workspace_id}/changes/{path}']:['path'],
  [repository+'/workspaces/{workspace_id}/merge/{branch}']:['branch'],
  [repository+'/dir/{resource}']:['resource'],
  [repository+'/data_frames/{resource}']:['resource'],
  [repository+'/commits/history/{resource}']:['resource'],
  [repository+'/merge/{base_head}']:['base_head'],
  [repository+'/compare/entries/{base_head}']:['base_head'],
};
export function oxenWildcardPath(schemaPath:string,parameters:Record<string,unknown>):string|undefined{
  const names=wildcards[schemaPath];if(!names)return undefined;
  const params={...parameters};
  for(const key of ['namespace','repo_name'])if(typeof params[key]==='string')safeSegment(params[key] as string);
  let output=schemaPath;
  for(const name of names){const value=params[name];if(typeof value!=='string')continue;output=output.replace('{'+name+'}',value.split('/').map(segment=>encodeURIComponent(segment)).join('/'));delete params[name];}
  return defaultPathSerializer(output,params);
}
export function rewriteOxenWildcardRequest(request:Request,schemaPath:string,parameters:Record<string,unknown>,baseUrl:string):Request|undefined{
  const pathname=oxenWildcardPath(schemaPath,parameters);if(pathname===undefined)return undefined;
  const current=new URL(request.url),url=new URL(baseUrl.replace(/\/$/,'')+pathname);url.search=current.search;
  if(url.href===current.href)return undefined;
  return new Request(url,request);
}
