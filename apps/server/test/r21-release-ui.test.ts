import test from 'node:test';
import assert from 'node:assert/strict';
import type {DatasetRelease,ReleaseAsset} from '../../../packages/shared/src/releases.js';
import {latestPublishedDatasetRelease,refreshedReleaseNotes,releaseCleanupWarning,shareableReleaseAssets} from '../../web/src/release-ui.js';

const release=(patch:Partial<DatasetRelease>={})=>({id:'full',kind:'release',status:'published',assets:[],...patch}) as DatasetRelease;
test('a changed comparison refreshes generated notes without overwriting an author explanation',()=>{
  const first='## Changes\nInitial dataset',next='## Changes\nAdded 2, modified 1';
  assert.equal(refreshedReleaseNotes('','',first),first);
  assert.equal(refreshedReleaseNotes(first,first,next),next);
  assert.equal(refreshedReleaseNotes(first+'\nOwner explanation',first,next),first+'\nOwner explanation');
  assert.equal(refreshedReleaseNotes('Custom before preview','',next),'Custom before preview');
});
test('only the current published release can supply explicitly shareable assets',()=>{
  const allowed:ReleaseAsset={id:'allowed',name:'fixed.zip',size:1,sha256:'a',mime:'application/zip',shareable:true,audience:'shared'};
  const internal={...allowed,id:'internal',name:'public.zip',audience:'internal' as const};
  const noAuthority={...allowed,id:'unspecified',shareable:undefined};
  const current=release({assets:[internal,noAuthority,allowed]});
  assert.deepEqual(shareableReleaseAssets(current).map(item=>item.id),['allowed']);
  assert.deepEqual(shareableReleaseAssets({...current,status:'draft'}),[]);
  assert.deepEqual(shareableReleaseAssets({...current,status:'withdrawn'}),[]);
  assert.deepEqual(shareableReleaseAssets({...current,kind:'snapshot'}),[]);
});
test('overview shows the sole published version immediately after publish without a separate latest selection',()=>{
  const current=release({id:'published',latest:false});
  assert.equal(latestPublishedDatasetRelease([release({id:'new-draft',status:'draft'}),current])?.id,'published');
  assert.equal(latestPublishedDatasetRelease([release({status:'ready'}),release({kind:'snapshot'})]),undefined);
  assert.equal(latestPublishedDatasetRelease([release({status:'withdrawn'})]),undefined);
});
test('a successful replacement with pending physical cleanup stays visibly distinct from complete cleanup',()=>{
  assert.match(releaseCleanupWarning(release({cleanupPending:true}))!,/旧下载链接已失效.*旧文件清理尚未完成/);
  assert.equal(releaseCleanupWarning(release({cleanupPending:false})),undefined);
  assert.equal(releaseCleanupWarning(release()),undefined);
  assert.equal(releaseCleanupWarning(release({status:'draft',cleanupPending:true})),undefined);
});
