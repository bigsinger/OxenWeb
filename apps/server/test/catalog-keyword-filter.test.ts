import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFacets,filterCatalogRepos,matchesProjectKeywords,toggleProjectKeyword} from '../../web/src/catalog.js';
import type {RepoSummary} from '../../../packages/shared/src/index.js';
const project=(name:string,keywords:string[],values=['text']):RepoSummary=>({namespace:'local',name,description:'Synthetic',defaultBranch:'main',updatedAt:'',size:0,fileCount:1,visibility:'private',tags:['legacy-only'],catalog:{branch:'main',state:'ready',templates:{},warnings:[],keywords,fields:[{key:'local/modality',organizationId:'local',dimensionId:'modality',name:'样本类型',description:'',type:'multi',options:[{id:'text',label:'文本',value:'text'},{id:'zip',label:'ZIP',value:'zip'}],values:values.map(id=>({id,label:id,value:id})),conflicted:false}]}});
test('keyword filtering is exact, combines independent keywords, and never creates a dimension match',()=>{
  const projects=[project('first',['aisec','benchmark']),project('second',['aisec'],['zip']),project('third',['not-aisec'])];
  assert.deepEqual(filterCatalogRepos(projects,[],'all',['AISEC','benchmark']).map(item=>item.name),['first']);
  assert.equal(matchesProjectKeywords(projects[0]!,['legacy-only']),false,'Other/default-branch tags must not stand in for main keywords');
  assert.equal(filterCatalogRepos(projects,[{key:'local/modality',values:['aisec']}],'all',['aisec']).length,0);
  assert.deepEqual(filterCatalogRepos(projects,[{key:'local/modality',values:['zip']}],'all',['aisec']).map(item=>item.name),['second']);
});
test('keyword toggle is immutable and preserves other active filters without replacing free search',()=>{
  const values=['benchmark'],added=toggleProjectKeyword(values,' aisec ');assert.deepEqual(added,['benchmark','aisec']);assert.deepEqual(values,['benchmark']);assert.deepEqual(toggleProjectKeyword(added,'AISEC'),['benchmark']);assert.deepEqual(toggleProjectKeyword(added,''),added);
});
test('structured non-role tags have proper catalog facets rather than disabled controls',()=>{
  const facet=catalogFacets([project('first',['aisec'])],[]).find(item=>item.key==='local/modality');assert.equal(facet?.role,'other');assert.equal(facet?.options.find(item=>item.id==='text')?.count,1);assert.equal(facet?.options.find(item=>item.id==='zip')?.count,0);
});
