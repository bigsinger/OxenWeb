import test from 'node:test';
import assert from 'node:assert/strict';
import {dimensionBindingState,latestPublishedDimension} from '../../web/src/dimension-binding.js';
import type {GovernanceDimension,PublishedDimension} from '../../../packages/shared/src/governance-types.js';

const snapshot=(version:number):PublishedDimension=>({id:'source',displayName:'来源',type:'multi',description:'来源定义',options:[{id:`v${version}`,displayName:`版本${version}`}],version,checksum:`checksum${version}`,publishedAt:'2026-11-08',publishedBy:'owner'});
const dimension=():GovernanceDimension=>({id:'source',revision:3,draft:snapshot(3),versions:[snapshot(2),snapshot(1),snapshot(3)],deprecated:false,updatedAt:'2026-11-08',updatedBy:'owner'});
test('new bindings use highest published version while viewing a saved binding never upgrades it',()=>{
  const value=dimension(),before=JSON.stringify(value);assert.equal(latestPublishedDimension(value)?.version,3);
  const status=dimensionBindingState(value,1);assert.equal(status.status,'pinned');assert.equal(status.selected?.version,1);assert.equal(status.latest?.version,3);
  assert.equal(JSON.stringify(value),before);assert.equal(dimensionBindingState(value,3).status,'latest');
});
test('missing or unpublished definitions have no fabricated version',()=>{
  const value=dimension();value.versions=[];assert.equal(latestPublishedDimension(value),undefined);assert.equal(dimensionBindingState(value,1).status,'missing');
  assert.equal(dimensionBindingState(undefined,1).status,'missing');
});
