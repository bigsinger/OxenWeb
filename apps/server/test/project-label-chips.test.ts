import test from 'node:test';
import assert from 'node:assert/strict';
import { withProjectKeywords } from '../../web/src/project-label-chips.js';
import { catalogKeyword, filterCatalogRepos } from '../../web/src/catalog.js';
import type { RepoSummary } from '../../../packages/shared/src/index.js';

test('aisec is visible among the first project chips while keywords remain distinct from structured options',()=>{
  const structured=[{key:'topic:injection',label:'提示词注入',field:{key:'local/topic'},value:{id:'injection'}},{key:'purpose:eval',label:'安全评测',field:{key:'local/purpose'},value:{id:'eval'}}];
  const chips=withProjectKeywords(structured,['benchmark','aisec','prompt-injection']);
  assert.deepEqual(chips.slice(0,3).map(item=>[item.kind,item.label]),[['keyword','aisec'],['structured','提示词注入'],['structured','安全评测']]);
  assert.equal(chips.length,5);assert.equal('field' in chips[0]!,false,'Keywords must never acquire a fabricated dimension');
  assert.equal(chips[1]!.kind==='structured'&&chips[1]!.field.key,'local/topic');
  assert.equal(structured.length,2,'Rendering does not mutate the source classification');
});

test('main keywords are normalized only for display identity and no fallback keywords are fabricated',()=>{
  assert.deepEqual(withProjectKeywords([],[' aisec ','AISEC','','benchmark']).map(item=>item.label),['aisec','benchmark']);
  assert.deepEqual(withProjectKeywords([],[]),[]);
  assert.equal(withProjectKeywords([{key:'topic:x',label:'aisec'}],['aisec']).filter(item=>item.kind==='keyword').length,1,'Matching text does not turn a keyword into a dimension');
});

test('main project keywords are searchable but do not satisfy structured dimension filters',()=>{
  const repo:RepoSummary={namespace:'local',name:'synthetic-project',description:'Synthetic',defaultBranch:'work',updatedAt:'',size:0,fileCount:1,visibility:'private',tags:[],catalog:{branch:'main',state:'unassigned',fields:[],templates:{},warnings:[],keywords:['aisec']}};
  assert.match(catalogKeyword(repo),/aisec/);
  assert.equal(filterCatalogRepos([repo],[{key:'local/source',values:['aisec']}]).length,0);
});
