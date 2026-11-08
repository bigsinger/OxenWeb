import test from 'node:test';
import assert from 'node:assert/strict';
import createClient from 'openapi-fetch';
import type { paths } from '../../../packages/contracts/src/oxen.js';
import { oxenWildcardPath,rewriteOxenWildcardRequest } from '../src/oxen-wildcard-paths.js';
const base='/api/repos/{namespace}/{repo_name}',params={namespace:'local',repo_name:'synthetic'};
test('known wildcards preserve separators but encode each Unicode/percent-containing segment once',()=>{
  assert.equal(oxenWildcardPath(base+'/workspaces/{workspace_id}/files/{path}',{...params,workspace_id:'test-id',path:'.oxenweb/dataset/rows'}),'/api/repos/local/synthetic/workspaces/test-id/files/.oxenweb/dataset/rows');
  assert.equal(oxenWildcardPath(base+'/workspaces/{workspace_id}/files/{path}',{...params,workspace_id:'test-id',path:'目录/literal%2Fname'}),'/api/repos/local/synthetic/workspaces/test-id/files/%E7%9B%AE%E5%BD%95/literal%252Fname');
  assert.equal(oxenWildcardPath(base+'/workspaces/{workspace_id}/merge/{branch}',{...params,workspace_id:'test-id',branch:'r2/live-123'}),'/api/repos/local/synthetic/workspaces/test-id/merge/r2/live-123');
  assert.equal(oxenWildcardPath(base+'/dir/{resource}',{...params,resource:'abc/目录/file%2F.json'}),'/api/repos/local/synthetic/dir/abc/%E7%9B%AE%E5%BD%95/file%252F.json');
  assert.equal(oxenWildcardPath(base+'/commits/{commit_id}',{...params,commit_id:'abc/def'}),undefined);
  assert.throws(()=>oxenWildcardPath(base+'/dir/{resource}',{...params,namespace:'bad/name',resource:'abc'}));
});
test('supported openapi middleware keeps multipart bytes/query intact without decoding unrelated URL segments',async()=>{
  let seen=false;const client=createClient<paths>({baseUrl:'http://127.0.0.1:3002',fetch:async request=>{seen=true;assert.equal(new URL(request.url).pathname,'/api/repos/local/synthetic/workspaces/test-id/files/.oxenweb/dataset/labels/row');const form=await request.formData();assert.equal(await (form.get('file') as File).text(),'synthetic-content');return new Response(JSON.stringify({status:'success'}),{headers:{'content-type':'application/json'}});}});
  client.use({onRequest:({request,schemaPath,params,options})=>rewriteOxenWildcardRequest(request,schemaPath,params.path??{},options.baseUrl)});
  const form=new FormData();form.append('file',new Blob(['synthetic-content']),'sample.json');await client.POST('/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files/{path}',{params:{path:{...params,workspace_id:'test-id',path:'.oxenweb/dataset/labels/row'}},body:form as unknown as {file:string},bodySerializer:body=>body as unknown as FormData});assert.equal(seen,true);
  const request=new Request('http://127.0.0.1:3002/api/repos/local/synthetic/dir/abc%2Fdata?page=2');const rewritten=rewriteOxenWildcardRequest(request,base+'/dir/{resource}',{...params,resource:'abc/data'},'http://127.0.0.1:3002')!;assert.equal(rewritten.url,'http://127.0.0.1:3002/api/repos/local/synthetic/dir/abc/data?page=2');
});
